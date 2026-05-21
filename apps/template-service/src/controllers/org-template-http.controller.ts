import {
  normalizeTemplateServiceError,
  OrgTemplateService,
  type TemplateStatus,
} from '@api-hub/template-core';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import type {
  ValidatedCloneOrgTemplate,
  ValidatedGetOrgVersions,
  ValidatedListOrg,
} from '../validators/request.validators';

let orgTemplateService: OrgTemplateService | undefined;

function getOrgTemplateService(): OrgTemplateService {
  if (!orgTemplateService) orgTemplateService = new OrgTemplateService();
  return orgTemplateService;
}

let ctrl: OrgTemplateHttpController | undefined;

export function getOrgTemplateHttpController(): OrgTemplateHttpController {
  if (!ctrl) ctrl = new OrgTemplateHttpController();
  return ctrl;
}

export class OrgTemplateHttpController {
  private readonly svc = getOrgTemplateService();

  async handleCloneToOrg(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedCloneOrgTemplate?: ValidatedCloneOrgTemplate })
      .validatedCloneOrgTemplate;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      const record = await this.svc.cloneTemplateVersion({
        organizationId: v.organizationId,
        masterTemplateId: v.templateId,
        masterVersionId: v.versionId,
        body: v.body,
        actorUserId: v.actorUserId,
      });
      return this.svc.toCreateResponse(record);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'clone_org_template_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleGetOrgVersions(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedGetOrgVersions?: ValidatedGetOrgVersions })
      .validatedGetOrgVersions;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      const result = await this.svc.getOrgTemplateVersions({
        organizationId: v.organizationId,
        templateId: v.templateId,
        version: v.query.version,
        resolve: v.query.resolve,
        status: v.query.status as TemplateStatus | undefined,
        nextToken: v.query.nextToken,
        limit: v.query.limit ?? 25,
      });

      if (result.mode === 'list') {
        return {
          items: result.items,
          ...(result.nextToken ? { nextToken: result.nextToken } : {}),
        };
      }

      return result.record;
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'get_org_template_versions_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleListOrg(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedListOrg?: ValidatedListOrg }).validatedListOrg;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.listOrgTemplates({
        organizationId: v.organizationId,
        condition: v.query.condition,
        status: v.query.status as TemplateStatus | undefined,
        templateType: v.query.templateType,
        specialty: v.query.specialty,
        nextToken: v.query.nextToken,
        limit: 25,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'list_org_templates_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }
}
