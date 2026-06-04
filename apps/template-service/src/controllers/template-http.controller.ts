import {
  normalizeTemplateServiceError,
  OrgTemplateRepository,
  OrgTemplateService,
  TemplateService,
  toMasterFullRecord,
  type ShareScope,
  type TemplateStatus,
} from '@api-hub/template-core';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import type {
  ValidatedCreateMaster,
  ValidatedGetMasterVersions,
  ValidatedListMaster,
  ValidatedListCompatible,
  ValidatedStatusTransition,
  ValidatedTemplateVersionPath,
  ValidatedUpdateMasterVersion,
  ValidatedSaveMaster,
} from '../validators/request.validators';
import { withNextPaginationKey } from '../utils/list-response.mapper';

let templateService: TemplateService | undefined;
let orgTemplateService: OrgTemplateService | undefined;

function getTemplateService(): TemplateService {
  if (!templateService) templateService = new TemplateService();
  return templateService;
}

function getOrgTemplateService(): OrgTemplateService {
  if (!orgTemplateService) orgTemplateService = new OrgTemplateService();
  return orgTemplateService;
}

let ctrl: TemplateHttpController | undefined;

export function getTemplateHttpController(): TemplateHttpController {
  if (!ctrl) ctrl = new TemplateHttpController();
  return ctrl;
}

export class TemplateHttpController {
  private readonly svc = getTemplateService();

  async handleCreateMaster(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedCreateMaster?: ValidatedCreateMaster })
      .validatedCreateMaster;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      const { record } = await this.svc.createMasterTemplate(v.body, v.actorUser);
      return this.svc.toCreateResponse(record);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'create_master_template_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleListMaster(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedListMaster?: ValidatedListMaster }).validatedListMaster;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    const { query } = v;

    try {
      const result = await this.svc.listMasterTemplates({
        category: query.category,
        condition: query.condition,
        conditionCode: query.conditionCode,
        country: query.country,
        status: query.status as TemplateStatus | undefined,
        shareScope: query.shareScope as ShareScope | undefined,
        templateType: query.templateType,
        language: query.language,
        specialty: query.specialty,
        templateCode: query.templateCode,
        nextToken: query.nextToken,
      });

      return withNextPaginationKey(result);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'list_master_templates_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleGetMasterVersions(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedGetMasterVersions?: ValidatedGetMasterVersions })
      .validatedGetMasterVersions;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    const { templateId, query } = v;

    try {
      const result = await this.svc.getMasterTemplateVersions({
        templateId,
        version: query.version,
        resolve: query.resolve,
        status: query.status as TemplateStatus | undefined,
        nextToken: query.nextToken,
      });

      if (result.mode === 'list') {
        return withNextPaginationKey({
          items: result.items,
          history: result.history,
          ...(result.nextToken ? { nextToken: result.nextToken } : {}),
        });
      }

      return toMasterFullRecord(result.record);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'get_master_template_versions_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleSaveMaster(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedSaveMaster?: ValidatedSaveMaster }).validatedSaveMaster;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      const record = await this.svc.saveMasterTemplate({
        templateId: v.templateId,
        templateVersionId: v.templateVersionId,
        body: v.body,
        actorUser: v.actorUser,
      });
      return this.svc.toSummary(record);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'save_master_template_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleUpdateMasterVersion(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedUpdateMasterVersion?: ValidatedUpdateMasterVersion })
      .validatedUpdateMasterVersion;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      const record = await this.svc.updateMasterTemplateVersion({
        templateId: v.templateId,
        versionId: v.versionId,
        body: v.body,
        actorUser: v.actorUser,
      });
      return this.svc.toSummary(record);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'update_master_template_version_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleListCompatible(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedListCompatible?: ValidatedListCompatible })
      .validatedListCompatible;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.listCompatibleTemplates({
        condition: v.query.condition,
        country: v.query.country,
        duration: v.query.duration,
        templateType: v.query.templateType,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'list_compatible_templates_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleStatusTransition(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedStatusTransition?: ValidatedStatusTransition })
      .validatedStatusTransition;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      const orgRepo = new OrgTemplateRepository();
      const orgMeta = await orgRepo.getOrgMeta(v.organizationId!, v.templateId);
      if (!orgMeta) {
        throw new BaseError('Org template not found', 404, 'NOT_FOUND', [
          { message: 'Org template not found' },
        ]);
      }

      const orgSvc = getOrgTemplateService();
      const record = await orgSvc.transitionOrgTemplateStatus({
        organizationId: v.organizationId!,
        templateId: v.templateId,
        versionId: v.versionId,
        body: v.body,
        actorUser: v.actorUser,
      });
      return orgSvc.toSummary(record);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'transition_template_status_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }
}
