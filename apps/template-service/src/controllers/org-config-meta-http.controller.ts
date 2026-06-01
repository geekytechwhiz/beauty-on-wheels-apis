import {
  normalizeTemplateServiceError,
  OrgConfigMetaService,
} from '@api-hub/template-core';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import type {
  ValidatedGetOrgConfigMetaByKey,
  ValidatedUpsertOrgConfigMeta,
} from '../validators/request.validators';

let svc: OrgConfigMetaService | undefined;

function getOrgConfigMetaService(): OrgConfigMetaService {
  if (!svc) svc = new OrgConfigMetaService();
  return svc;
}

export class OrgConfigMetaHttpController {
  private readonly orgConfigSvc = getOrgConfigMetaService();

  async handleListOrgConfigMeta(_req: LambdaRequest) {
    try {
      const items = await this.orgConfigSvc.listOrgConfigMeta();
      return { items };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, { logEvent: 'list_org_config_meta_error' });
    }
  }

  async handleGetOrgConfigMetaByKey(req: LambdaRequest) {
    const v = (
      req as LambdaRequest & { validatedGetOrgConfigMetaByKey?: ValidatedGetOrgConfigMetaByKey }
    ).validatedGetOrgConfigMetaByKey;
    if (!v) {
      throw new BaseError('Request was not validated before controller', 500, 'INTERNAL_ERROR', [
        { message: 'Request was not validated before controller' },
      ]);
    }

    try {
      const result = await this.orgConfigSvc.getOrgConfigMetaByKey(v.configKey);
      return result.document;
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, { logEvent: 'get_org_config_meta_by_key_error' });
    }
  }

  async handleUpsertOrgConfigMeta(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedUpsertOrgConfigMeta?: ValidatedUpsertOrgConfigMeta })
      .validatedUpsertOrgConfigMeta;
    if (!v) {
      throw new BaseError('Request was not validated before controller', 500, 'INTERNAL_ERROR', [
        { message: 'Request was not validated before controller' },
      ]);
    }

    try {
      const result = await this.orgConfigSvc.upsertOrgConfigMeta(v.configKey, v.body);
      return result.document;
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, { logEvent: 'upsert_org_config_meta_error' });
    }
  }
}

let ctrl: OrgConfigMetaHttpController | undefined;

export function getOrgConfigMetaHttpController(): OrgConfigMetaHttpController {
  if (!ctrl) ctrl = new OrgConfigMetaHttpController();
  return ctrl;
}
