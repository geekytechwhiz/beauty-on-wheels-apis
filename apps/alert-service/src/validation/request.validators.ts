/**
 * Create-alert request validation (user-service: `request.validators.ts` + `throwVal`).
 * On success sets `req.validatedCreateAlert`; on failure throws `Error` with `statusCode`, `code`, optional `details`.
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { LambdaRequest } from '@api-hub/utils';
import {
  createAlertHttpBodySchema,
  type CreateAlertHttpBody,
} from '../validators/alert.schemas';
import {
  assertCanCreateAlerts,
  getActorUserIdForRequest,
  getOrganizationIdForRequest,
} from '../utils/helpers';

/** Same shape as user-service `throwVal` (`apps/user-service/src/validation/request.validators.ts`). */
function throwVal(
  message: string,
  statusCode = 400,
  code = 'VALIDATION_ERROR',
  details?: Array<{ field?: string; message: string }>,
): never {
  const err = new Error(message) as Error & {
    statusCode: number;
    code: string;
    details?: Array<{ field?: string; message: string }>;
  };
  err.statusCode = statusCode;
  err.code = code;
  if (details) err.details = details;
  throw err;
}

function parseHttpBody(
  event: APIGatewayProxyEvent,
): { ok: true; raw: unknown } | { ok: false; reason: 'empty' | 'malformed_json' } {
  const b = event.body;
  if (b == null || b === '') return { ok: false, reason: 'empty' };
  if (typeof b === 'object') return { ok: true, raw: b };
  try {
    return { ok: true, raw: JSON.parse(String(b)) };
  } catch {
    return { ok: false, reason: 'malformed_json' };
  }
}

export type ValidatedCreateAlert = {
  orgId: string;
  actorUserId: string | undefined;
  body: CreateAlertHttpBody;
  authHeader: string | undefined;
};

/**
 * Resolves org/actor, permission, JSON body, then `createAlertHttpBodySchema.safeParse` + HTTP UI defaults
 * (same flow as `validateCreateUser` → `createUserSchema.safeParse` + `req.validatedCreateUser`).
 */
export function validateCreateAlertRequest(req: LambdaRequest): void {
  const event = req.event;
  const authHeader = req.context.authHeader as string | undefined;

  const orgId = getOrganizationIdForRequest(event, authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED', [
      { message: 'Missing or invalid tenant in token' },
    ]);
  }

  assertCanCreateAlerts(event);

  const parsedBody = parseHttpBody(event);
  if (!parsedBody.ok) {
    if (parsedBody.reason === 'malformed_json') {
      throwVal('Malformed JSON', 400, 'MALFORMED_JSON', [{ message: 'Malformed JSON' }]);
    }
    throwVal('Invalid request body', 400, 'BAD_REQUEST', [{ message: 'Request body is required' }]);
  }

  const result = createAlertHttpBodySchema.safeParse(parsedBody.raw);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((i) => ({
        field: i.path.join('.') || undefined,
        message: i.message,
      })),
    );
  }

  const actorUserId = getActorUserIdForRequest(event, authHeader);
  (req as LambdaRequest & { validatedCreateAlert: ValidatedCreateAlert }).validatedCreateAlert = {
    orgId,
    actorUserId,
    body: result.data,
    authHeader,
  };
}
