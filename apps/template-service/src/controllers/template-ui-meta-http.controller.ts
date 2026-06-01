import {
  normalizeTemplateServiceError,
  TemplateUiMetaService,
} from '@api-hub/template-core';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import type {
  ValidatedGetUiMetaById,
  ValidatedGetUiMetaByType,
  ValidatedUpsertUiMeta,
} from '../validators/request.validators';

let svc: TemplateUiMetaService | undefined;

function getUiMetaService(): TemplateUiMetaService {
  if (!svc) svc = new TemplateUiMetaService();
  return svc;
}

export class TemplateUiMetaHttpController {
  private readonly uiMetaSvc = getUiMetaService();

  async handleListUiMeta(_req: LambdaRequest) {
    try {
      const items = await this.uiMetaSvc.listUiMeta();
      return { items };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, { logEvent: 'list_template_ui_meta_error' });
    }
  }

  async handleGetUiMetaById(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedGetUiMetaById?: ValidatedGetUiMetaById })
      .validatedGetUiMetaById;
    if (!v) {
      throw new BaseError('Request was not validated before controller', 500, 'INTERNAL_ERROR', [
        { message: 'Request was not validated before controller' },
      ]);
    }

    try {
      const result = await this.uiMetaSvc.getUiMetaById(v.metaId);
      return result.document;
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, { logEvent: 'get_template_ui_meta_by_id_error' });
    }
  }

  async handleGetUiMetaByType(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedGetUiMetaByType?: ValidatedGetUiMetaByType })
      .validatedGetUiMetaByType;
    if (!v) {
      throw new BaseError('Request was not validated before controller', 500, 'INTERNAL_ERROR', [
        { message: 'Request was not validated before controller' },
      ]);
    }

    try {
      const result = await this.uiMetaSvc.getUiMetaByTemplateType(v.templateType);
      return result.document;
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, { logEvent: 'get_template_ui_meta_by_type_error' });
    }
  }

  async handleUpsertUiMeta(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedUpsertUiMeta?: ValidatedUpsertUiMeta })
      .validatedUpsertUiMeta;
    if (!v) {
      throw new BaseError('Request was not validated before controller', 500, 'INTERNAL_ERROR', [
        { message: 'Request was not validated before controller' },
      ]);
    }

    try {
      const result = await this.uiMetaSvc.upsertUiMeta(v.templateType, v.body);
      return result.document;
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, { logEvent: 'upsert_template_ui_meta_error' });
    }
  }
}

let ctrl: TemplateUiMetaHttpController | undefined;

export function getTemplateUiMetaHttpController(): TemplateUiMetaHttpController {
  if (!ctrl) ctrl = new TemplateUiMetaHttpController();
  return ctrl;
}
