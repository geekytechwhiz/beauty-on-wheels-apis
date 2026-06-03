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
  ValidatedUpdateOrgVersion,
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
      const result = await this.svc.cloneTemplateVersion({
        organizationId: v.organizationId,
        masterTemplateId: v.templateId,
        masterVersionId: v.versionId,
        body: v.body,
        actorUserId: v.actorUserId,
      });
      return this.svc.toDeriveEnableResponse(result, v.body?.templateName);
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

  async handleUpdateOrgVersion(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedUpdateOrgVersion?: ValidatedUpdateOrgVersion })
      .validatedUpdateOrgVersion;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      const record = await this.svc.updateOrgTemplateVersion({
        organizationId: v.organizationId,
        templateId: v.templateId,
        versionId: v.versionId,
        body: v.body,
        actorUserId: v.actorUserId,
      });
      return this.svc.toSummary(record);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'update_org_template_version_error',
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
      return await this.svc.listOrgEnableCatalog({
        organizationId: v.organizationId,
        categoryCode: v.query.categoryCode ?? v.query.category,
        condition: v.query.condition,
        conditionCode: v.query.conditionCode,
        templateType: v.query.templateType,
        templateName: v.query.templateName,
        country: v.query.country,
        status: v.query.status,
        nextToken: v.query.nextToken,
        limit: v.query.limit ?? 25,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'list_org_templates_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }
}
