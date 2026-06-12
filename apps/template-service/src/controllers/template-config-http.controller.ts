import { normalizeTemplateServiceError, TemplateConfigService } from '@api-hub/template-core';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import { getTemplateConfigMetaService } from '../services/template-config-meta.service';
import type {
  ValidatedCreateTemplateConfig,
  ValidatedGetTemplateConfig,
  ValidatedPostTemplateConfigMeta,
  ValidatedListTemplateConfigs,
  ValidatedUpdateTemplateConfig,
} from '../validators/request.validators';

let svc: TemplateConfigService | undefined;

function getTemplateConfigService(): TemplateConfigService {
  if (!svc) svc = new TemplateConfigService();
  return svc;
}

export class TemplateConfigHttpController {
  private readonly configSvc = getTemplateConfigService();
  private readonly metaSvc = getTemplateConfigMetaService();

  async handleListConfigs(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedListTemplateConfigs?: ValidatedListTemplateConfigs })
      .validatedListTemplateConfigs;
    if (!v) {
      throw new BaseError('Request was not validated before controller', 500, 'INTERNAL_ERROR', [
        { message: 'Request was not validated before controller' },
      ]);
    }

    try {
      return await this.configSvc.listConfigs({
        configType: v.configType,
        templateType: v.templateType,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, { logEvent: 'list_template_configs_error' });
    }
  }

  async handleGetConfig(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedGetTemplateConfig?: ValidatedGetTemplateConfig })
      .validatedGetTemplateConfig;
    if (!v) {
      throw new BaseError('Request was not validated before controller', 500, 'INTERNAL_ERROR', [
        { message: 'Request was not validated before controller' },
      ]);
    }

    try {
      return await this.configSvc.getConfigById(v.configId);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, { logEvent: 'get_template_config_error' });
    }
  }

  async handleCreateConfig(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedCreateTemplateConfig?: ValidatedCreateTemplateConfig })
      .validatedCreateTemplateConfig;
    if (!v) {
      throw new BaseError('Request was not validated before controller', 500, 'INTERNAL_ERROR', [
        { message: 'Request was not validated before controller' },
      ]);
    }

    try {
      return await this.configSvc.createConfig(v.body);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, { logEvent: 'create_template_config_error' });
    }
  }

  async handlePostMeta(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedPostTemplateConfigMeta?: ValidatedPostTemplateConfigMeta })
      .validatedPostTemplateConfigMeta;
    if (!v) {
      throw new BaseError('Request was not validated before controller', 500, 'INTERNAL_ERROR', [
        { message: 'Request was not validated before controller' },
      ]);
    }

    try {
      return await this.metaSvc.getMeta({
        metadataTypeCodes: v.metadataTypeCodes,
        authHeader: req.context.authHeader,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, { logEvent: 'get_template_config_meta_error' });
    }
  }

  async handleUpdateConfig(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedUpdateTemplateConfig?: ValidatedUpdateTemplateConfig })
      .validatedUpdateTemplateConfig;
    if (!v) {
      throw new BaseError('Request was not validated before controller', 500, 'INTERNAL_ERROR', [
        { message: 'Request was not validated before controller' },
      ]);
    }

    try {
      return await this.configSvc.updateConfig(v.configId, v.body);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, { logEvent: 'update_template_config_error' });
    }
  }
}

let ctrl: TemplateConfigHttpController | undefined;

export function getTemplateConfigHttpController(): TemplateConfigHttpController {
  if (!ctrl) ctrl = new TemplateConfigHttpController();
  return ctrl;
}
