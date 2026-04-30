import type { LambdaRequest } from '@api-hub/utils';
import {
  createAlertHttpBodySchema,
  listAlertsQuerySchema,
  type CreateAlertHttpBody,
  type ListAlertsQuery,
} from './alert.schemas';
import {
  getActorUserIdForRequest,
  getOrganizationIdForRequest,
} from '../utils/helpers';

/** Allowed `sourceType` values per `inputType` (must match {@link createAlertHttpBodySchema}). */
const SOURCE_TYPE_MAP: Record<string, string[]> = {
  MISSED_READING: ['MONITORING_SERVICE'],
  MISSING_DEVICE: ['DEVICE_MONITORING', 'DEVICE_WORKFLOW'],
};

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

 

function validateSourceAgainstInput(inputType: string, sourceType: string) {
  const allowed = SOURCE_TYPE_MAP[inputType];

  if (!allowed) {
    throwVal('Unsupported inputType', 422, 'VALIDATION_ERROR', [
      { field: 'inputType', message: `Unsupported inputType: ${inputType}` },
    ]);
  }

  if (!allowed.includes(sourceType)) {
    throwVal('Invalid sourceType for inputType', 422, 'VALIDATION_ERROR', [
      {
        field: 'sourceType',
        message: `sourceType '${sourceType}' is not allowed for inputType '${inputType}'`,
      },
    ]);
  }
}

export type ValidatedCreateAlert = {
  orgId: string;
  actorUserId: string | undefined;
  body: CreateAlertHttpBody;
  authHeader: string | undefined;
};
export function validateCreateHttpAlertRequest(input: unknown): CreateAlertHttpBody {
  return createAlertHttpBodySchema.parse(input);
}
export function validateCreateAlertRequest(req: LambdaRequest): void {
  const body = req.body;
 
  validateSourceAgainstInput(body.inputType, body.sourceType);

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const actorUserId = getActorUserIdForRequest(req.event, req.context.authHeader);
  (req as LambdaRequest & { validatedCreateAlert: ValidatedCreateAlert }).validatedCreateAlert = {
    orgId,
    actorUserId,
    body: body,
    authHeader: req.context.authHeader,
  };
}

export function parseListAlertsQuery(
  qp: Record<string, string | string[] | undefined>,
): ListAlertsQuery {
  const first = (v: string | string[] | undefined): string | undefined => {
    if (v === undefined || v === null) return undefined;
    return Array.isArray(v) ? v[0] : v;
  };

  const raw = {
    queue: first(qp.queue),
    patientId: first(qp.patientId),
    state: first(qp.state),
    assignment: first(qp.assignment),
    priority: first(qp.priority),
    inputType: first(qp.inputType),
    dateFrom: first(qp.dateFrom),
    dateTo: first(qp.dateTo),
    search: first(qp.search),
    pageSize: first(qp.pageSize),
    nextToken: first(qp.nextToken),
  };

  const result = listAlertsQuerySchema.safeParse(raw);

  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      400,
      'VALIDATION_ERROR',
      result.error.issues.map((i) => ({
        field: i.path.join('.') || undefined,
        message: i.message,
      })),
    );
  }

  return result.data;
}