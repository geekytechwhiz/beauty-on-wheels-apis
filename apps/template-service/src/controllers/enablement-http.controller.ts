import { EnablementService, normalizeTemplateServiceError } from '@api-hub/template-core';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import type { ValidatedCreateEnablement } from '../validators/request.validators';

let enablementService: EnablementService | undefined;

function getEnablementService(): EnablementService {
  if (!enablementService) enablementService = new EnablementService();
  return enablementService;
}

let ctrl: EnablementHttpController | undefined;

export function getEnablementHttpController(): EnablementHttpController {
  if (!ctrl) ctrl = new EnablementHttpController();
  return ctrl;
}

export class EnablementHttpController {
  private readonly svc = getEnablementService();

  async handleCreateEnablement(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedCreateEnablement?: ValidatedCreateEnablement })
      .validatedCreateEnablement;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.createOrgEnablement({
        body: v.body,
        actorUserId: v.actorUserId,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'create_org_enablement_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }
}
