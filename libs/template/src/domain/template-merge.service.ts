import { loadRuleSet } from '@api-hub/rule-engine';
import type { ResolvedTemplate, TemplateDefinition, TemplateDocument, TemplateMetadata } from './template.types';

/**
 * Deep-merges plain objects; non-object values in `overlay` overwrite `base`.
 * Used when resolving an org template (child) over a base template.
 */
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
    return { config: {}, rules: [], actions: [] };
  }

  const value = raw as Record<string, unknown>;
  const config =
    value.config && typeof value.config === 'object' && !Array.isArray(value.config)
      ? (value.config as Record<string, unknown>)
      : {};

  return {
    config,
    rules: 'rules' in value ? loadRuleSet(value.rules) : [],
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
    masterTemplateVersionId: metadata.masterTemplateVersionId,
    snapshotRef: metadata.snapshotRef,
    snapshotId: metadata.snapshotId,
    profile: metadata.profile,
    profileKey: metadata.profileKey,
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

/**
 * Applies a child template layer on top of an already-resolved base.
 *
 * - **config**: deep-merged from base → child.
 * - **rules** / **actions**: if the child document defines the property (including an **empty array**),
 *   that value **replaces** the base entirely; it is not a patch. To inherit base rules/actions,
 *   omit the key in the child document (do not send `rules: []` unless you intend to clear rules).
 */
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
