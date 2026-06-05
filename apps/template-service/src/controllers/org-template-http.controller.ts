import {
  normalizeTemplateServiceError,
  OrgTemplateService,
  type TemplateStatus,
} from '@api-hub/template-core';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import type {
  ValidatedCloneOrgTemplate,
  ValidatedGetOrgVersionStatus,
  ValidatedGetOrgVersions,
  ValidatedListOrg,
  ValidatedSetOrgTemplateEnable,
  ValidatedUpdateOrgVersion,
} from '../validators/request.validators';
import { enrichRecordActorsForApi } from '../utils/enrich-record-actors';
import { withNextPaginationKey } from '../utils/list-response.mapper';

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
        actorUser: v.actorUser,
      });
      const organizationMeta = v.body?.organizationMeta
        ? {
            id: v.body.organizationMeta.id,
            name: v.body.organizationMeta.name.trim(),
            description: v.body.organizationMeta.description ?? null,
          }
        : {
            id: v.organizationId,
            name: v.organizationId,
            description: null,
          };
      return this.svc.toDeriveEnableResponse(result, {
        organizationMeta,
      });
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
      });

      if (result.mode === 'list') {
        return withNextPaginationKey(
          await enrichRecordActorsForApi({
            items: result.items,
            ...(result.nextToken ? { nextToken: result.nextToken } : {}),
          }),
        );
      }

      return enrichRecordActorsForApi(result.record);
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
        actorUser: v.actorUser,
      });
      return this.svc.toSummary(record);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'update_org_template_version_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleListOrgCopies(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedListOrg?: ValidatedListOrg }).validatedListOrg;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    if (!v.organizationId) {
      throw new BaseError(
        'organizationId is required to list org template copies',
        400,
        'VALIDATION_ERROR',
        [{ message: 'organizationId is required to list org template copies' }],
      );
    }

    try {
      return withNextPaginationKey(
        await enrichRecordActorsForApi(
          await this.svc.listOrgTemplates({
            organizationId: v.organizationId,
            organizationName: v.query.organizationName,
            organizationDescription: v.query.organizationDescription,
            condition: v.query.condition ?? v.query.conditionCode,
            status: v.query.status,
            templateType: v.query.templateType,
            specialty: v.query.specialty,
            nextToken: v.query.nextToken,
          }),
        ),
      );
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'list_org_template_copies_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleSetOrgTemplateEnable(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedSetOrgTemplateEnable?: ValidatedSetOrgTemplateEnable })
      .validatedSetOrgTemplateEnable;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.setOrgTemplateEnablement({
        organizationId: v.organizationId,
        masterTemplateId: v.masterTemplateId,
        templateEnabled: v.body.templateEnabled,
        organizationName: v.body.organizationMeta?.name,
        organizationDescription: v.body.organizationMeta?.description,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'set_org_template_enable_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleGetOrgVersionStatus(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedGetOrgVersionStatus?: ValidatedGetOrgVersionStatus })
      .validatedGetOrgVersionStatus;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.getOrgVersionStatus({
        organizationId: v.organizationId,
        masterTemplateId: v.masterTemplateId,
        organizationName: v.query.organizationName,
        organizationDescription: v.query.organizationDescription,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'get_org_version_status_error',
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
      return withNextPaginationKey(
        await this.svc.listOrgEnabled({
          organizationId: v.organizationId,
          organizationName: v.query.organizationName,
          organizationDescription: v.query.organizationDescription,
          categoryCode: v.query.categoryCode ?? v.query.category,
          condition: v.query.condition,
          conditionCode: v.query.conditionCode,
          templateType: v.query.templateType,
          templateName: v.query.templateName,
          templateId: v.query.templateId,
          templateEnabled: v.templateEnabledFilter,
          nextToken: v.query.nextToken ?? v.query.nextPaginationKey,
        }),
      );
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'list_org_templates_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }
}
