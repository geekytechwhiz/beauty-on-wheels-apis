import { deepMerge } from '../deep-merge';
import type { ResolvedTemplate, TemplateDefinition, TemplateDocument, TemplateMetadata } from '../types';

export function parseTemplateDocument(raw: unknown): TemplateDocument {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { config: {}, rules: {}, actions: [] };
  }
  const o = raw as Record<string, unknown>;
  const config =
    o.config && typeof o.config === 'object' && !Array.isArray(o.config)
      ? (o.config as Record<string, unknown>)
      : {};
  return {
    config,
    rules: 'rules' in o ? o.rules : {},
    actions: 'actions' in o ? o.actions : [],
  };
}

export function mergeMetadataAndDocument(meta: TemplateMetadata, doc: TemplateDocument): TemplateDefinition {
  return {
    templateId: meta.templateId,
    orgId: meta.orgId,
    version: meta.version,
    type: meta.type,
    schemaRef: meta.schemaRef || undefined,
    extendsTemplateId: meta.baseTemplateId,
    extendsVersion: meta.baseVersion,
    extendsBaseOrgId: meta.baseOrgId,
    config: { ...doc.config },
    rules: doc.rules,
    actions: doc.actions,
    status: meta.status,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    createdBy: meta.createdBy,
  };
}

export function toResolved(t: TemplateDefinition): ResolvedTemplate {
  return {
    templateId: t.templateId,
    orgId: t.orgId,
    version: t.version,
    config: { ...t.config },
    rules: t.rules,
    actions: t.actions,
    resolutionChain: [{ templateId: t.templateId, version: t.version }],
  };
}

/**
 * Overlay a child template onto an already-resolved base.
 */
export function mergeResolvedLayer(base: ResolvedTemplate, layer: TemplateDefinition): ResolvedTemplate {
  const rules =
    layer.rules !== undefined && layer.rules !== null ? layer.rules : base.rules;
  const actions =
    layer.actions !== undefined && layer.actions !== null ? layer.actions : base.actions;

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
