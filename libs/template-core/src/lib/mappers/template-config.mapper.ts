import type { TemplateConfigRecord } from '../models/api/template-config.types';
import { TEMPLATE_CONFIG_TYPES } from '../models/api/template-config.types';

function normalizeConfigType(raw: unknown): TemplateConfigRecord['configType'] | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const key = raw.trim().toUpperCase();
  return (TEMPLATE_CONFIG_TYPES as readonly string[]).includes(key)
    ? (key as TemplateConfigRecord['configType'])
    : undefined;
}

function normalizeTemplateType(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  return raw.trim().toUpperCase();
}

/**
 * Maps stored S3 JSON into the HTTP response shape.
 * `configType` and `templateType` are hoisted to the top level (not duplicated in `document`).
 */
export function toTemplateConfigRecord(
  configId: string,
  document: Record<string, unknown>,
): TemplateConfigRecord {
  const configType = normalizeConfigType(document.configType);
  const templateType = normalizeTemplateType(document.templateType);

  const { configType: _c, templateType: _t, ...documentBody } = document;

  return {
    configId,
    ...(configType ? { configType } : {}),
    ...(templateType ? { templateType } : {}),
    document: documentBody,
  };
}
