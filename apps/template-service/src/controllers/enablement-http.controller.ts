import { EnablementService, normalizeTemplateServiceError } from '@api-hub/template-core';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import { HTTP_NO_CONTENT } from '../utils/api-handler.util';
import type {
  ValidatedCreateEnablement,
  ValidatedGetEnablement,
  ValidatedListEnablementsByOrg,
  ValidatedPatchEnablement,
  ValidatedSearchEnablements,
} from '../validators/request.validators';

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

  async handleSearchEnablements(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedSearchEnablements?: ValidatedSearchEnablements })
      .validatedSearchEnablements;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.searchOrgEnablements({
        organizationId: v.query.organizationId,
        masterTemplateVersionId: v.query.masterTemplateVersionId,
        nextToken: v.query.nextToken,
        limit: v.query.limit,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'search_org_enablements_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleListEnablementsByOrg(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedListEnablementsByOrg?: ValidatedListEnablementsByOrg })
      .validatedListEnablementsByOrg;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.listOrgEnablementsByOrg({
        organizationId: v.organizationId,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'list_org_enablements_by_org_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleGetEnablement(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedGetEnablement?: ValidatedGetEnablement })
      .validatedGetEnablement;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.getOrgEnablementById(v.enablementId);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'get_org_enablement_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handlePatchEnablement(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedPatchEnablement?: ValidatedPatchEnablement })
      .validatedPatchEnablement;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      const result = await this.svc.updateOrgEnablement({
        enablementId: v.enablementId,
        body: v.body,
        actorUserId: v.actorUserId,
      });
      if (result === null) {
        return HTTP_NO_CONTENT;
      }
      return result;
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'patch_org_enablement_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }
}
