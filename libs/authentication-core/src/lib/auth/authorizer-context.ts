import type { AuthContext } from './auth-context';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function parseAuthorizerStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
  }
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      return parseAuthorizerStringList(JSON.parse(trimmed) as unknown);
    } catch {
      return [];
    }
  }
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toAuthorizerContext(ctx: AuthContext): Record<string, string> {
  // API Gateway rejects authorizer context keys whose values are empty strings.
  const context: Record<string, string> = {
    identityId: ctx.identityId,
    roles: JSON.stringify(ctx.roles ?? []),
    permissions: JSON.stringify(ctx.permissions ?? []),
  };
  if (ctx.userId?.trim()) {
    context.userId = ctx.userId.trim();
  }
  return context;
}

export function fromAuthorizerContext(
  raw: Record<string, unknown> | undefined | null,
): AuthContext | undefined {
  if (!raw) {
    return undefined;
  }
  const principalId = asString(raw.principalId);
  const identityId =
    asString(raw.identityId) ??
    (principalId && principalId !== 'unauthorized' && principalId !== 'anonymous'
      ? principalId
      : undefined);
  if (!identityId) {
    return undefined;
  }
  const userId = asString(raw.userId);
  return {
    identityId,
    ...(userId ? { userId } : {}),
    roles: parseAuthorizerStringList(raw.roles),
    permissions: parseAuthorizerStringList(raw.permissions),
    claims: {},
  };
}

export function readAuthorizerContextFromEvent(
  event:
    | { requestContext?: { authorizer?: Record<string, unknown> | null } }
    | undefined,
): AuthContext | undefined {
  return fromAuthorizerContext(event?.requestContext?.authorizer);
}
