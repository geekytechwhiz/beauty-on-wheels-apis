import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import { env } from '../configs/env.config';

export interface CallerVendorIdentity {
  vendorId: string;
  role: 'owner' | 'staff';
  status?: string;
}

/**
 * Resolves the authenticated provider's vendor from Vendor Service `/vendors/me`.
 * Never trusts a client-supplied vendorId for ownership.
 */
export async function resolveCallerVendor(
  request: LambdaRequest,
): Promise<CallerVendorIdentity> {
  const authorization = headerValue(request, 'authorization');
  if (!authorization) {
    throw new UnauthorizedError('Unauthorized');
  }
  const base = env.VENDOR_BASE_URL?.trim().replace(/\/$/, '');
  if (!base) {
    throw new ForbiddenError('Vendor identity could not be verified');
  }

  let response: Response;
  try {
    response = await fetch(`${base}/vendors/me`, {
      method: 'GET',
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new ForbiddenError('Vendor identity could not be verified');
  }

  if (response.status === 401) {
    throw new UnauthorizedError('Unauthorized');
  }
  if (response.status === 403 || response.status === 404) {
    throw new ForbiddenError('Not authorized as a vendor');
  }
  if (!response.ok) {
    throw new ForbiddenError('Vendor identity could not be verified');
  }

  const body = await response.json() as unknown;
  const record = unwrapData(body);
  const vendorId = typeof record.vendorId === 'string' ? record.vendorId.trim() : '';
  const hasVendor = record.hasVendor === true;
  const roleRaw = nestedString(record, 'membership', 'role');
  const role = roleRaw === 'staff' ? 'staff' : roleRaw === 'owner' ? 'owner' : undefined;

  if (!hasVendor || !vendorId || !role) {
    throw new ForbiddenError('Not authorized as a vendor');
  }

  return {
    vendorId,
    role,
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
  };
}

function headerValue(request: LambdaRequest, name: string): string | undefined {
  const headers = request.event?.headers ?? {};
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function unwrapData(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  const root = body as Record<string, unknown>;
  if (root.data && typeof root.data === 'object' && !Array.isArray(root.data)) {
    return root.data as Record<string, unknown>;
  }
  return root;
}

function nestedString(
  record: Record<string, unknown>,
  parent: string,
  child: string,
): string | undefined {
  const nested = record[parent];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return undefined;
  }
  const value = (nested as Record<string, unknown>)[child];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
