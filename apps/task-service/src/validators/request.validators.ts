import type { LambdaRequest } from '@api-hub/utils';

import { getOrganizationIdForRequest } from '../utils/helpers';
import type { CreateMonitoringActionHttpBody } from './task.schemas';

function throwVal(
  message: string,
  statusCode = 400,
  code = 'VALIDATION_ERROR',
): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  throw err;
}

export type ValidatedCreateMonitoringAction = {
  orgId: string;
  authHeader: string | undefined;
  body: CreateMonitoringActionHttpBody;
};

export function validateCreateMonitoringActionRequest(req: LambdaRequest): void {
  const body = req.body as CreateMonitoringActionHttpBody;

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  (req as LambdaRequest & { validatedCreateMonitoringAction: ValidatedCreateMonitoringAction }).validatedCreateMonitoringAction =
    {
      orgId,
      body,
      authHeader: req.context.authHeader,
    };
}
