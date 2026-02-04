import axios from 'axios';
import { createLogger, createChildLogger } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

/** Minimal shape from Organization API for existence/status checks (e.g. create user validation). */
export interface OrganizationApiPayload {
  organizationID?: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * Fetches organization details via Organization service HTTP API.
 * Use for service-to-service checks (e.g. create user validation) so organization remains source of truth.
 * Optional authHeader is forwarded for downstream authorization.
 */
export async function getOrganization(
  organizationId: string,
  authHeader?: string,
): Promise<OrganizationApiPayload | null> {
  const apiBaseUrl = process.env.ORGANIZATION_API_URL;
  const timeoutMs = Number(process.env.ORGANIZATION_API_TIMEOUT_MS) || 10_000;
  const logger = createChildLogger(baseLogger, { organizationId });
  logger.info({ event: 'Fetching organization details via API', organizationId });

  if (!apiBaseUrl) {
    logger.error({ event: 'Organization API URL not configured', organizationId });
    return null;
  }

  try {
    const url = `${apiBaseUrl.replace(/\/$/, '')}/organization/${organizationId}`;
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      timeout: timeoutMs,
    });
    const payload = response.data?.data ?? response.data ?? null;
    logger.info({
      event: 'Organization API response',
      status: response.status,
      organizationId,
      hasData: payload !== null,
    });
    return payload as OrganizationApiPayload | null;
  } catch (err) {
    const error = err as { response?: { status: number }; message?: string };
    const status = error?.response?.status;
    logger.error({
      event: 'Error fetching organization details',
      err: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
      status,
      organizationId,
    });
    return null;
  }
}
