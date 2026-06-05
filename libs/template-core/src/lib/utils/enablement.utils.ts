import type { EnablementDdbRecord, EnablementMeta } from '../models/api/enablement.types';

export function parseMasterTemplateIdFromVersionId(masterTemplateVersionId: string): string | undefined {
  const match = masterTemplateVersionId.trim().match(/^(.+)-V\d+$/i);
  return match?.[1];
}

export function resolveEnablementMasterTemplateId(meta: EnablementMeta): string | undefined {
  const explicit = meta.masterTemplateId?.trim();
  if (explicit) return explicit;
  return parseMasterTemplateIdFromVersionId(meta.masterTemplateVersionId);
}

export function isActiveEnablement(record: EnablementDdbRecord): boolean {
  const to = record.meta.effectiveTo;
  return to === undefined || to === null || String(to).trim() === '';
}
