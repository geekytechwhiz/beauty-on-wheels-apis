import {
  normalizeTemplateServiceError,
  TemplateService,
  type ShareScope,
  type TemplateStatus,
} from '@api-hub/template-core';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import type {
  ValidatedCreateMaster,
  ValidatedListMaster,
  ValidatedSaveMaster,
} from '../validators/request.validators';
import { enrichRecordActorsForApi } from '../utils/enrich-record-actors';
import { withNextPaginationKey } from '../utils/list-response.mapper';

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
      const { record } = await this.svc.createMasterTemplate(v.body, v.actorUser);
      return enrichRecordActorsForApi(this.svc.toCreateResponse(record));
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
        templateName: query.templateName,
        active: query.active,
        nextToken: query.nextToken,
      });

      return withNextPaginationKey(await enrichRecordActorsForApi(result));
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'list_master_templates_error',
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
}
