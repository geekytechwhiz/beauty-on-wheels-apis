import type { ResolvedTemplate, TemplateDefinition, TemplateDocument, TemplateMetadata } from './template.types';

export function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overlay)) {
    const baseValue = base[key];
    const overlayValue = overlay[key];
    if (
      overlayValue !== null &&
      typeof overlayValue === 'object' &&
      !Array.isArray(overlayValue) &&
      baseValue !== null &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
    ) {
      out[key] = deepMerge(
        baseValue as Record<string, unknown>,
        overlayValue as Record<string, unknown>,
      );
    } else {
      out[key] = overlayValue;
    }
  }
  return out;
}

export function parseTemplateDocument(raw: unknown): TemplateDocument {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { config: {}, rules: {}, actions: [] };
  }

  const value = raw as Record<string, unknown>;
  const config =
    value.config && typeof value.config === 'object' && !Array.isArray(value.config)
      ? (value.config as Record<string, unknown>)
      : {};

  return {
    config,
    rules: 'rules' in value ? value.rules : {},
    actions: 'actions' in value ? value.actions : [],
  };
}

export function mergeMetadataAndDocument(
  metadata: TemplateMetadata,
  document: TemplateDocument,
): TemplateDefinition {
  return {
    templateId: metadata.templateId,
    orgId: metadata.orgId,
    version: metadata.version,
    type: metadata.type,
    schemaRef: metadata.schemaRef || undefined,
    extendsTemplateId: metadata.baseTemplateId,
    extendsVersion: metadata.baseVersion,
    extendsBaseOrgId: metadata.baseOrgId,
    config: { ...document.config },
    rules: document.rules,
    actions: document.actions,
    status: metadata.status,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    createdBy: metadata.createdBy,
  };
}

export function toResolvedTemplate(template: TemplateDefinition): ResolvedTemplate {
  return {
    templateId: template.templateId,
    orgId: template.orgId,
    version: template.version,
    config: { ...template.config },
    rules: template.rules,
    actions: template.actions,
    resolutionChain: [{ templateId: template.templateId, version: template.version }],
  };
}

export function mergeResolvedTemplateLayer(
  base: ResolvedTemplate,
  layer: TemplateDefinition,
): ResolvedTemplate {
  const rules = layer.rules !== undefined && layer.rules !== null ? layer.rules : base.rules;
  const actions = layer.actions !== undefined && layer.actions !== null ? layer.actions : base.actions;

  return {
    templateId: layer.templateId,
    orgId: layer.orgId,
    version: layer.version,
    config: deepMerge(base.config, layer.config),
    rules,
    actions,
    resolutionChain: [...base.resolutionChain, { templateId: layer.templateId, version: layer.version }],
  };
}
