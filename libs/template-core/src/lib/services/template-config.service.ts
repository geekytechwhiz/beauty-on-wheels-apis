import type {
  TemplateConfigListResult,
  TemplateConfigRecord,
} from '../models/api/template-config.types';
import { TemplateConfigS3Store } from '../storage/template-config-s3.store';
import { templateConfigValidationError } from '../storage/template-config-s3.errors';

function validationError(message: string): never {
  templateConfigValidationError(message);
}

function extractConfigId(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    validationError('Request body must be a JSON object');
  }
  const id = typeof (body as Record<string, unknown>).id === 'string'
    ? (body as Record<string, unknown>).id.trim()
    : '';
  if (!id) {
    validationError('id is required');
  }
  return id;
}

function matchesListFilters(
  document: Record<string, unknown>,
  filters: { configType?: string; templateType?: string },
): boolean {
  if (filters.configType?.trim()) {
    const configType =
      typeof document.configType === 'string' ? document.configType.trim().toUpperCase() : '';
    if (configType !== filters.configType.trim().toUpperCase()) {
      return false;
    }
  }

  if (filters.templateType?.trim()) {
    const templateType =
      typeof document.templateType === 'string' ? document.templateType.trim().toUpperCase() : '';
    if (templateType !== filters.templateType.trim().toUpperCase()) {
      return false;
    }
  }

  return true;
}

export class TemplateConfigService {
  constructor(private readonly store = new TemplateConfigS3Store()) {}

  async listConfigs(filters: {
    configType?: string;
    templateType?: string;
  } = {}): Promise<TemplateConfigListResult> {
    const rows = await this.store.listAll();
    const items = rows
      .filter((row) => matchesListFilters(row.document, filters))
      .map(
        (row): TemplateConfigRecord => ({
          configId: row.configId,
          document: row.document,
        }),
      );

    return { items };
  }

  async getConfigById(configId: string): Promise<TemplateConfigRecord> {
    const normalizedId = configId.trim();
    if (!normalizedId) {
      validationError('configId is required');
    }

    const row = await this.store.getById(normalizedId);
    return {
      configId: row.configId,
      document: row.document,
    };
  }

  async createConfig(body: unknown): Promise<TemplateConfigRecord> {
    const configId = extractConfigId(body);
    const document = body as Record<string, unknown>;
    const row = await this.store.create(configId, document);
    return {
      configId: row.configId,
      document: row.document,
    };
  }

  async updateConfig(configId: string, body: unknown): Promise<TemplateConfigRecord> {
    const normalizedId = configId.trim();
    if (!normalizedId) {
      validationError('configId is required');
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      validationError('Request body must be a JSON object');
    }

    const document = body as Record<string, unknown>;
    const bodyId = typeof document.id === 'string' ? document.id.trim() : '';
    if (!bodyId) {
      validationError('id is required');
    }
    if (bodyId !== normalizedId) {
      validationError(`body.id must match path configId (${normalizedId})`);
    }

    const row = await this.store.replace(normalizedId, document);
    return {
      configId: row.configId,
      document: row.document,
    };
  }
}
