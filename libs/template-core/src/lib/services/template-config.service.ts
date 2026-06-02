import { OrgConfigMetaService } from './org-config-meta.service';
import { TemplateUiMetaService } from './template-ui-meta.service';
import type {
  TemplateConfigListResult,
  TemplateConfigRecord,
  TemplateConfigType,
} from '../models/api/template-config.types';
import { TEMPLATE_CONFIG_TYPES } from '../models/api/template-config.types';

function validationError(message: string): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = 400;
  err.code = 'VALIDATION_ERROR';
  throw err;
}

function notFoundError(message: string): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = 404;
  err.code = 'NOT_FOUND';
  throw err;
}

function normalizeConfigType(raw?: string): TemplateConfigType | undefined {
  if (!raw?.trim()) return undefined;
  const key = raw.trim().toUpperCase();
  return (TEMPLATE_CONFIG_TYPES as readonly string[]).includes(key)
    ? (key as TemplateConfigType)
    : undefined;
}

function toTemplateRecord(
  metaId: string,
  templateType: string,
  fileName: string,
  document: Record<string, unknown>,
): TemplateConfigRecord {
  return {
    configId: metaId,
    configType: 'TEMPLATE',
    templateType,
    fileName,
    document,
  };
}

function toOrgRecord(
  configKey: string,
  fileName: string,
  document: Record<string, unknown>,
): TemplateConfigRecord {
  return {
    configId: configKey,
    configType: 'ORG',
    configKey,
    fileName,
    document,
  };
}

export class TemplateConfigService {
  constructor(
    private readonly uiMeta = new TemplateUiMetaService(),
    private readonly orgConfig = new OrgConfigMetaService(),
  ) {}

  async listConfigs(filters: {
    configType?: string;
    templateType?: string;
  }): Promise<TemplateConfigListResult> {
    const configType = normalizeConfigType(filters.configType);
    if (filters.configType?.trim() && !configType) {
      validationError(`Invalid configType. Allowed: ${TEMPLATE_CONFIG_TYPES.join(', ')}`);
    }

    if (filters.templateType?.trim()) {
      const result = await this.uiMeta.getUiMetaByTemplateType(filters.templateType);
      return {
        items: [
          toTemplateRecord(
            result.metaId,
            result.templateType,
            result.fileName,
            result.document as Record<string, unknown>,
          ),
        ],
      };
    }

    const items: TemplateConfigRecord[] = [];

    if (!configType || configType === 'TEMPLATE') {
      const templateItems = await this.uiMeta.listUiMeta();
      for (const row of templateItems) {
        items.push(
          toTemplateRecord(
            row.metaId,
            row.templateType,
            row.fileName,
            row.document as Record<string, unknown>,
          ),
        );
      }
    }

    if (!configType || configType === 'ORG') {
      const orgItems = await this.orgConfig.listOrgConfigMeta();
      for (const row of orgItems) {
        items.push(
          toOrgRecord(row.configKey, row.fileName, row.document as Record<string, unknown>),
        );
      }
    }

    return { items };
  }

  async getConfigById(configId: string): Promise<TemplateConfigRecord> {
    const normalizedId = configId.trim();
    if (!normalizedId) {
      validationError('configId is required');
    }

    try {
      const ui = await this.uiMeta.getUiMetaById(normalizedId);
      return toTemplateRecord(
        ui.metaId,
        ui.templateType,
        ui.fileName,
        ui.document as Record<string, unknown>,
      );
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'statusCode' in e &&
        (e as { statusCode: number }).statusCode !== 404
      ) {
        throw e;
      }
    }

    try {
      const org = await this.orgConfig.getOrgConfigMetaByKey(normalizedId);
      return toOrgRecord(
        org.configKey,
        org.fileName,
        org.document as Record<string, unknown>,
      );
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'statusCode' in e &&
        (e as { statusCode: number }).statusCode === 404
      ) {
        notFoundError(`Template config not found for id ${normalizedId}`);
      }
      throw e;
    }
  }

  async createConfig(body: unknown): Promise<TemplateConfigRecord> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      validationError('Request body must be a JSON object');
    }
    const payload = body as Record<string, unknown>;
    const configType = normalizeConfigType(
      typeof payload.configType === 'string' ? payload.configType : undefined,
    );
    if (!configType) {
      validationError(`configType is required (${TEMPLATE_CONFIG_TYPES.join(', ')})`);
    }

    if (configType === 'TEMPLATE') {
      const { configType: _c, configKey: _k, ...rest } = payload;
      const result = await this.uiMeta.createUiMeta(rest);
      return toTemplateRecord(
        result.metaId,
        result.templateType,
        result.fileName,
        result.document as Record<string, unknown>,
      );
    }

    const { configType: _c, templateType: _t, id: _i, fields: _f, ...rest } = payload;
    const result = await this.orgConfig.createOrgConfigMeta(rest);
    return toOrgRecord(
      result.configKey,
      result.fileName,
      result.document as Record<string, unknown>,
    );
  }

  async updateConfig(configId: string, body: unknown): Promise<TemplateConfigRecord> {
    const normalizedId = configId.trim();
    if (!normalizedId) {
      validationError('configId is required');
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      validationError('Request body must be a JSON object');
    }
    const payload = body as Record<string, unknown>;

    try {
      const existing = await this.uiMeta.getUiMetaById(normalizedId);
      const result = await this.uiMeta.updateUiMeta(existing.templateType, payload);
      return toTemplateRecord(
        result.metaId,
        result.templateType,
        result.fileName,
        result.document as Record<string, unknown>,
      );
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'statusCode' in e &&
        (e as { statusCode: number }).statusCode !== 404
      ) {
        throw e;
      }
    }

    try {
      await this.orgConfig.getOrgConfigMetaByKey(normalizedId);
    } catch (orgMissing: unknown) {
      if (
        orgMissing &&
        typeof orgMissing === 'object' &&
        'statusCode' in orgMissing &&
        (orgMissing as { statusCode: number }).statusCode === 404
      ) {
        notFoundError(`Template config not found for id ${normalizedId}`);
      }
      throw orgMissing;
    }

    const result = await this.orgConfig.updateOrgConfigMeta(normalizedId, payload);
    return toOrgRecord(
      result.configKey,
      result.fileName,
      result.document as Record<string, unknown>,
    );
  }
}
