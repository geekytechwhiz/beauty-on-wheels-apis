import type { TemplateDocument } from '../domain/template.types';

function isExpandableNode(node: unknown): boolean {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const mode = (node as Record<string, unknown>).metadataMode;
  return mode === 'Expandable';
}

/**
 * True when newCfg differs from oldCfg only by:
 * - adding keys under an object whose metadataMode is Expandable, or
 * - adding keys while parent chain is under such an Expandable node.
 */
function isExpandableOnlyMetadataExpansion(
  oldNode: unknown,
  newNode: unknown,
  underExpandable: boolean,
): boolean {
  if (oldNode === newNode) return true;
  if (oldNode === null || oldNode === undefined) {
    return underExpandable;
  }
  if (newNode === null || newNode === undefined) {
    return false;
  }
  if (typeof oldNode !== typeof newNode) {
    return false;
  }
  if (Array.isArray(oldNode) && Array.isArray(newNode)) {
    if (newNode.length < oldNode.length) return false;
    for (let i = 0; i < oldNode.length; i++) {
      if (!isExpandableOnlyMetadataExpansion(oldNode[i], newNode[i], underExpandable)) {
        return false;
      }
    }
    for (let i = oldNode.length; i < newNode.length; i++) {
      if (!underExpandable) return false;
    }
    return true;
  }
  if (Array.isArray(oldNode) || Array.isArray(newNode)) {
    return false;
  }

  const oldO = oldNode as Record<string, unknown>;
  const newO = newNode as Record<string, unknown>;
  const hereExpand = isExpandableNode(oldNode) || underExpandable;

  for (const k of Object.keys(oldO)) {
    if (!(k in newO)) {
      return false;
    }
    if (!isExpandableOnlyMetadataExpansion(oldO[k], newO[k], hereExpand)) {
      return false;
    }
  }
  for (const k of Object.keys(newO)) {
    if (!(k in oldO)) {
      if (!hereExpand) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Returns whether a new template version is required when moving from old → new document.
 */
export function requiresNewVersion(oldDoc: TemplateDocument, newDoc: TemplateDocument): boolean {
  const oldRules = JSON.stringify(oldDoc.rules ?? []);
  const newRules = JSON.stringify(newDoc.rules ?? []);
  if (oldRules !== newRules) {
    return true;
  }

  const oldActions = JSON.stringify(oldDoc.actions ?? null);
  const newActions = JSON.stringify(newDoc.actions ?? null);
  if (oldActions !== newActions) {
    return true;
  }

  const oldCfg = oldDoc.config ?? {};
  const newCfg = newDoc.config ?? {};

  if (metadataModeFixedChanged(oldCfg, newCfg)) {
    return true;
  }

  if (linkingChanged(oldCfg, newCfg)) {
    return true;
  }

  if (JSON.stringify(oldCfg) === JSON.stringify(newCfg)) {
    return false;
  }

  if (isExpandableOnlyMetadataExpansion(oldCfg, newCfg, false)) {
    return false;
  }

  return true;
}

function metadataModeFixedChanged(
  oldCfg: Record<string, unknown>,
  newCfg: Record<string, unknown>,
): boolean {
  return collectMetadataModes(oldCfg).join('|') !== collectMetadataModes(newCfg).join('|');
}

function collectMetadataModes(cfg: Record<string, unknown>, out: string[] = []): string[] {
  for (const v of Object.values(cfg)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (typeof o.metadataMode === 'string') {
        out.push(String(o.metadataMode));
      }
      collectMetadataModes(o, out);
    }
  }
  return out;
}

function linkingChanged(oldCfg: Record<string, unknown>, newCfg: Record<string, unknown>): boolean {
  const oldLinks = extractLinks(oldCfg);
  const newLinks = extractLinks(newCfg);
  return JSON.stringify(oldLinks) !== JSON.stringify(newLinks);
}

function extractLinks(cfg: Record<string, unknown>): unknown {
  const sections = cfg.sections;
  if (!Array.isArray(sections)) return [];
  return sections.map((s) =>
    s && typeof s === 'object' ? (s as Record<string, unknown>).fields ?? {} : {},
  );
}
