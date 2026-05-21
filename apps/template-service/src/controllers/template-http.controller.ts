import {
  normalizeTemplateServiceError,
  TemplateService,
  type TemplateStatus,
} from '@api-hub/template-core';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import type {
  ValidatedCreateMaster,
  ValidatedGetMasterMeta,
  ValidatedGetMasterVersions,
  ValidatedListMaster,
  ValidatedStatusTransition,
  ValidatedTemplateVersionPath,
  ValidatedUpdateMasterVersion,
} from '../validators/request.validators';

let templateService: TemplateService | undefined;

function getTemplateService(): TemplateService {
  if (!templateService) templateService = new TemplateService();
  return templateService;
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
      const { record } = await this.svc.createMasterTemplate(v.body, v.actorUserId);
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
        country: query.country,
        status: query.status as TemplateStatus | undefined,
        templateType: query.templateType,
        language: query.language,
        specialty: query.specialty,
        templateCode: query.templateCode,
        nextToken: query.nextToken,
        limit: 25,
      });

      return {
        items: result.items,
        ...(result.nextToken ? { nextToken: result.nextToken } : {}),
      };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'list_master_templates_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleGetMasterMeta(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedGetMasterMeta?: ValidatedGetMasterMeta })
      .validatedGetMasterMeta;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.getMasterTemplateMeta(v.templateId);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'get_master_template_meta_error',
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
        limit: query.limit ?? 25,
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
        logEvent: 'get_master_template_versions_error',
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
        actorUserId: v.actorUserId,
      });
      return this.svc.toSummary(record);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'update_master_template_version_error',
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
      const record = await this.svc.transitionMasterTemplateStatus({
        templateId: v.templateId,
        versionId: v.versionId,
        body: v.body,
        actorUserId: v.actorUserId,
      });
      return this.svc.toSummary(record);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'transition_master_template_status_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }
}
