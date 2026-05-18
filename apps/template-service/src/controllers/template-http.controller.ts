import {
  normalizeTemplateServiceError,
  TemplateService,
  type TemplateStatus,
} from '@api-hub/template-core';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import type { ValidatedCreateMaster, ValidatedListMaster } from '../validators/request.validators';

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
}
