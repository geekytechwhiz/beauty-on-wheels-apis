import type { TemplateHistoryEntry } from '../mappers/template-http.dto';
import type {
  OrgDerivedAdoptChangeRow,
  OrgDerivedAdoptPreview,
} from '../models/api/org-derived.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { TemplateActorUser } from '../models/template-actor.model';
import {
  formatTemplateDisplayValue,
  isComplexTemplateFieldValue,
  resolveTemplateFieldLabel,
  TEMPLATE_DISPLAY_VALUE_UPDATED,
} from './template-display.utils';
import { normalizeTemplateActor } from './template-actor.utils';
import {
  compareTemplateDisplayVersions,
  formatTemplateVersionLabel,
  resolveTemplateDisplayVersion,
} from './template.utils';

const COMPARE_DOC_KEYS = ['fieldValues', 'rules', 'links', 'steps', 'carePlanAttributes', 'overrides'] as const;

const ADOPT_FOOTER_NOTE =
  'Your existing Org Templates and Care Plans are unchanged — adoption only updates this variant record.';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

function extractDocumentFields(record: TemplateDdbRecord): Record<string, unknown> {
  const META_ROW_KEYS = new Set([
    'pk',
    'sk',
    'entityType',
    'meta',
    'gsi1pk',
    'gsi1sk',
    'gsi2pk',
    'gsi2sk',
    'gsi3pk',
    'gsi3sk',
    'gsi4pk',
    'gsi4sk',
    'gsi5pk',
    'gsi5sk',
    'versionHistory',
  ]);
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!META_ROW_KEYS.has(key)) {
      doc[key] = value;
    }
  }
  return doc;
}

function formatOverrideBrief(value: unknown): string {
  const brief = formatTemplateDisplayValue(value);
  return brief === TEMPLATE_DISPLAY_VALUE_UPDATED ? 'your value' : brief;
}

function buildAddedMessage(label: string, preserved: boolean): string {
  if (preserved) {
    return `A new optional '${label}' section has been added. Your existing configuration is preserved.`;
  }
  return `New '${label}' section with updated configuration.`;
}

function buildRemovedMessage(label: string, customized: boolean): string {
  if (customized) {
    return `The legacy '${label}' section was removed. You have customisations here.`;
  }
  return `The '${label}' section was removed.`;
}

function buildChangedMessage(
  label: string,
  before: string,
  after: string,
  preserved: boolean,
  overrideBrief: string,
): string {
  const beforeNum = Number(before);
  const afterNum = Number(after);
  const isNumeric =
    !Number.isNaN(beforeNum) &&
    !Number.isNaN(afterNum) &&
    before !== '—' &&
    after !== '—';

  if (isNumeric && afterNum > beforeNum) {
    const base = `${label} increased from ${before} to ${after}.`;
    return preserved ? `${base} Your org override (${overrideBrief}) will be preserved.` : base;
  }

  if (label.toLowerCase().includes('review cadence') || label.toLowerCase().includes('cadence')) {
    const base = `Default review cadence changed from ${before} to ${after}.`;
    return preserved ? `${base} Your org override (${overrideBrief}) will be preserved.` : base;
  }

  const base = `'${label}' changed from ${before} to ${after}.`;
  return preserved ? `${base} Your org override (${overrideBrief}) will be preserved.` : base;
}

function variantHasLocalOverride(
  key: string,
  variantFv: Record<string, unknown>,
  snapshotFv: Record<string, unknown>,
): boolean {
  if (!(key in variantFv)) return false;
  return stableJson(variantFv[key]) !== stableJson(snapshotFv[key]);
}

function diffFieldValueChanges(
  fromFv: Record<string, unknown>,
  toFv: Record<string, unknown>,
  variantFv: Record<string, unknown>,
  snapshotFv: Record<string, unknown>,
): {
  added: OrgDerivedAdoptChangeRow[];
  changed: OrgDerivedAdoptChangeRow[];
  removed: OrgDerivedAdoptChangeRow[];
} {
  const added: OrgDerivedAdoptChangeRow[] = [];
  const changed: OrgDerivedAdoptChangeRow[] = [];
  const removed: OrgDerivedAdoptChangeRow[] = [];

  const fromKeys = new Set(Object.keys(fromFv));
  const toKeys = new Set(Object.keys(toFv));

  for (const key of toKeys) {
    if (!fromKeys.has(key)) {
      const preserved = variantHasLocalOverride(key, variantFv, snapshotFv);
      const label = resolveTemplateFieldLabel(key, toFv);
      added.push({
        key,
        label,
        message: buildAddedMessage(label, preserved),
        preserved,
      });
    }
  }

  for (const key of fromKeys) {
    if (!toKeys.has(key)) {
      const customized = variantHasLocalOverride(key, variantFv, snapshotFv);
      const label = resolveTemplateFieldLabel(key, fromFv);
      removed.push({
        key,
        label,
        message: buildRemovedMessage(label, customized),
        severity: customized ? 'warning' : 'info',
        requiresReview: customized,
        preserved: false,
      });
    }
  }

  for (const key of toKeys) {
    if (!fromKeys.has(key)) continue;
    if (stableJson(fromFv[key]) === stableJson(toFv[key])) continue;

    const preserved = variantHasLocalOverride(key, variantFv, snapshotFv);
    const label = resolveTemplateFieldLabel(key, toFv);
    const before = formatTemplateDisplayValue(fromFv[key]);
    const after = formatTemplateDisplayValue(toFv[key]);
    const complex = isComplexTemplateFieldValue(fromFv[key]) || isComplexTemplateFieldValue(toFv[key]);
    const message = complex
      ? preserved
        ? `'${label}' was updated. Your org override will be preserved.`
        : `'${label}' was updated.`
      : buildChangedMessage(label, before, after, preserved, formatOverrideBrief(variantFv[key]));

    changed.push({
      key,
      label,
      message,
      ...(complex ? {} : { before, after }),
      preserved,
    });
  }

  return { added, changed, removed };
}

const RULE_FLAG_LABELS: Record<string, string> = {
  enable: 'enabled',
  orgedit: 'org edit',
  defaultedit: 'default edit',
  add: 'add permission',
  delete: 'delete permission',
};

function summarizeRuleNodeDelta(before: unknown, after: unknown, label: string): string {
  const b = asRecord(before);
  const a = asRecord(after);
  const parts: string[] = [];

  for (const [flag, human] of Object.entries(RULE_FLAG_LABELS)) {
    if ((flag in b || flag in a) && b[flag] !== a[flag]) {
      parts.push(`${human} changed from ${formatTemplateDisplayValue(b[flag])} to ${formatTemplateDisplayValue(a[flag])}`);
    }
  }

  if (parts.length > 0) {
    return `'${label}' rules updated (${parts.join('; ')}).`;
  }
  return `'${label}' rules were updated.`;
}

function diffRulesChanges(
  fromRules: Record<string, unknown>,
  toRules: Record<string, unknown>,
  variantRules: Record<string, unknown>,
  snapshotRules: Record<string, unknown>,
  fieldValues: Record<string, unknown>,
): {
  added: OrgDerivedAdoptChangeRow[];
  changed: OrgDerivedAdoptChangeRow[];
  removed: OrgDerivedAdoptChangeRow[];
} {
  const added: OrgDerivedAdoptChangeRow[] = [];
  const changed: OrgDerivedAdoptChangeRow[] = [];
  const removed: OrgDerivedAdoptChangeRow[] = [];

  const fromKeys = new Set(Object.keys(fromRules));
  const toKeys = new Set(Object.keys(toRules));

  for (const key of toKeys) {
    if (!fromKeys.has(key)) {
      const label = resolveTemplateFieldLabel(key, fieldValues);
      added.push({
        key: `rules.${key}`,
        label,
        message: `New '${label}' rules were added.`,
      });
    }
  }

  for (const key of fromKeys) {
    if (!toKeys.has(key)) {
      const label = resolveTemplateFieldLabel(key, fieldValues);
      const customized =
        key in variantRules && stableJson(variantRules[key]) !== stableJson(snapshotRules[key]);
      removed.push({
        key: `rules.${key}`,
        label,
        message: customized
          ? `The '${label}' rules were removed. You have customisations here.`
          : `The '${label}' rules were removed.`,
        severity: customized ? 'warning' : 'info',
        requiresReview: customized,
        preserved: false,
      });
    }
  }

  for (const key of toKeys) {
    if (!fromKeys.has(key)) continue;
    if (stableJson(fromRules[key]) === stableJson(toRules[key])) continue;

    const preserved =
      key in variantRules && stableJson(variantRules[key]) !== stableJson(snapshotRules[key]);
    const label = resolveTemplateFieldLabel(key, fieldValues);
    const detail = summarizeRuleNodeDelta(fromRules[key], toRules[key], label);
    changed.push({
      key: `rules.${key}`,
      label,
      message: preserved ? `${detail} Your org customisations will be preserved.` : detail,
      preserved,
    });
  }

  return { added, changed, removed };
}

function resolveRulesForHistorySnapshot(
  historyEntry: TemplateHistoryEntry,
  latestRow: TemplateDdbRecord,
  variantVersionRow?: TemplateDdbRecord,
): Record<string, unknown> | undefined {
  if (historyEntry.rules && typeof historyEntry.rules === 'object' && !Array.isArray(historyEntry.rules)) {
    return { ...(historyEntry.rules as Record<string, unknown>) };
  }

  if (!variantVersionRow) return undefined;

  const historyFv = asRecord(historyEntry.fieldValues);
  const variantFv = asRecord(variantVersionRow.fieldValues);
  if (stableJson(historyFv) === stableJson(variantFv)) {
    return asRecord(variantVersionRow.rules);
  }

  return asRecord(latestRow.rules);
}

function reconstructCanonicalSnapshotFromHistory(
  latestRow: TemplateDdbRecord,
  snapshotVersion: number,
  snapshotVersionId?: string,
  variantVersionRow?: TemplateDdbRecord,
): TemplateDdbRecord | null {
  const history = latestRow.versionHistory as TemplateHistoryEntry[] | undefined;
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }

  const entry =
    history.find((item) => item.version === snapshotVersion) ??
    (snapshotVersionId
      ? history.find((item) => item.templateVersionId === snapshotVersionId)
      : undefined);

  if (!entry?.fieldValues) {
    return null;
  }

  const rules = resolveRulesForHistorySnapshot(entry, latestRow, variantVersionRow);

  return {
    ...latestRow,
    meta: {
      ...latestRow.meta,
      version: entry.version,
      templateVersionId: entry.templateVersionId ?? latestRow.meta.templateVersionId,
    },
    fieldValues: { ...entry.fieldValues },
    ...(rules ? { rules } : {}),
  };
}

/**
 * Resolves the canonical org template row at the variant's copy-time snapshot.
 * Org templates bump version in-place on a single VERSION row, so loading by
 * `derivedFromOrgTemplateVersionId` returns the latest content — use versionHistory.
 */
export function resolveCanonicalSnapshotRow(params: {
  latestRow: TemplateDdbRecord;
  snapshotVersion: number;
  snapshotVersionId?: string;
  rowAtVersionId?: TemplateDdbRecord | null;
  variantVersionRow?: TemplateDdbRecord;
}): TemplateDdbRecord | null {
  const latestVersion = resolveTemplateDisplayVersion(params.latestRow.meta);
  if (compareTemplateDisplayVersions(latestVersion, params.snapshotVersion) <= 0) {
    return null;
  }

  const rowAtId = params.rowAtVersionId;
  if (rowAtId) {
    const rowAtIdVersion = resolveTemplateDisplayVersion(rowAtId.meta);
    if (
      compareTemplateDisplayVersions(rowAtIdVersion, params.snapshotVersion) === 0 &&
      compareTemplateDisplayVersions(latestVersion, rowAtIdVersion) > 0
    ) {
      return rowAtId;
    }
  }

  return reconstructCanonicalSnapshotFromHistory(
    params.latestRow,
    params.snapshotVersion,
    params.snapshotVersionId,
    params.variantVersionRow,
  );
}

export function detectVariantLocalChanges(
  variantVersionRow: TemplateDdbRecord,
  canonicalSnapshotRow: TemplateDdbRecord,
): boolean {
  const variantPayload: Record<string, unknown> = {};
  const snapshotPayload: Record<string, unknown> = {};
  for (const key of COMPARE_DOC_KEYS) {
    if (key in variantVersionRow) {
      variantPayload[key] = variantVersionRow[key as keyof TemplateDdbRecord];
    }
    if (key in canonicalSnapshotRow) {
      snapshotPayload[key] = canonicalSnapshotRow[key as keyof TemplateDdbRecord];
    }
  }
  return stableJson(variantPayload) !== stableJson(snapshotPayload);
}

export function buildOrgDerivedAdoptPreview(params: {
  variantMeta: TemplateDdbRecord['meta'];
  variantVersionRow: TemplateDdbRecord;
  canonicalFromRow: TemplateDdbRecord;
  canonicalToRow: TemplateDdbRecord;
  sourceOrgTemplateId: string;
}): OrgDerivedAdoptPreview | null {
  const fromVersion = resolveTemplateDisplayVersion(params.canonicalFromRow.meta);
  const toVersion = resolveTemplateDisplayVersion(params.canonicalToRow.meta);
  if (compareTemplateDisplayVersions(toVersion, fromVersion) <= 0) {
    return null;
  }

  const fromFv = asRecord(params.canonicalFromRow.fieldValues);
  const toFv = asRecord(params.canonicalToRow.fieldValues);
  const variantFv = asRecord(params.variantVersionRow.fieldValues);
  const snapshotFv = fromFv;

  const fromRules = asRecord(params.canonicalFromRow.rules);
  const toRules = asRecord(params.canonicalToRow.rules);
  const variantRules = asRecord(params.variantVersionRow.rules);
  const snapshotRules = fromRules;

  const fvChanges = diffFieldValueChanges(fromFv, toFv, variantFv, snapshotFv);
  const ruleChanges = diffRulesChanges(
    fromRules,
    toRules,
    variantRules,
    snapshotRules,
    { ...fromFv, ...toFv },
  );
  const localChangesPresent = detectVariantLocalChanges(
    params.variantVersionRow,
    params.canonicalFromRow,
  );

  const changes = {
    added: [...fvChanges.added, ...ruleChanges.added],
    changed: [...fvChanges.changed, ...ruleChanges.changed],
    removed: [...fvChanges.removed, ...ruleChanges.removed],
  };

  const templateName = params.variantMeta.templateName?.trim() || 'template';
  const fromVersionLabel = formatTemplateVersionLabel(fromVersion);
  const toVersionLabel = formatTemplateVersionLabel(toVersion);

  return {
    available: true,
    title: `What's new in ${templateName} ${fromVersionLabel} → ${toVersionLabel}`,
    fromVersion,
    fromVersionLabel,
    toVersion,
    toVersionLabel,
    sourceOrgTemplateId: params.sourceOrgTemplateId,
    fromOrgTemplateVersionId:
      params.canonicalFromRow.meta.templateVersionId ??
      params.variantMeta.derivedFromOrgTemplateVersionId ??
      '',
    toOrgTemplateVersionId: params.canonicalToRow.meta.templateVersionId ?? '',
    localChangesPresent,
    localChangesLabel: localChangesPresent ? 'Present' : 'None',
    footerNote: ADOPT_FOOTER_NOTE,
    changes,
  };
}

export function mergeVariantAdoptDocument(
  variantVersionRow: TemplateDdbRecord,
  canonicalLatestRow: TemplateDdbRecord,
  canonicalSnapshotRow: TemplateDdbRecord,
): Record<string, unknown> {
  const variantDoc = extractDocumentFields(variantVersionRow);
  const latestDoc = extractDocumentFields(canonicalLatestRow);
  const snapshotDoc = extractDocumentFields(canonicalSnapshotRow);

  const merged: Record<string, unknown> = { ...latestDoc };

  const variantFv = asRecord(variantDoc.fieldValues);
  const snapshotFv = asRecord(snapshotDoc.fieldValues);
  const latestFv = asRecord(latestDoc.fieldValues);
  const mergedFv = { ...latestFv };

  for (const key of Object.keys(variantFv)) {
    if (stableJson(variantFv[key]) !== stableJson(snapshotFv[key])) {
      mergedFv[key] = variantFv[key];
    }
  }
  merged.fieldValues = mergedFv;

  const variantRules = asRecord(variantDoc.rules);
  const snapshotRules = asRecord(snapshotDoc.rules);
  const latestRules = asRecord(latestDoc.rules);
  const mergedRules = { ...latestRules };

  for (const key of Object.keys(variantRules)) {
    if (stableJson(variantRules[key]) !== stableJson(snapshotRules[key])) {
      mergedRules[key] = variantRules[key];
    }
  }
  if (Object.keys(mergedRules).length > 0) {
    merged.rules = mergedRules;
  }

  return merged;
}

export function applyAdoptHistoryOverride(
  record: TemplateDdbRecord,
  params: {
    fromVersion: number;
    toVersion: number;
    sourceOrgTemplateId: string;
    actor?: TemplateActorUser;
  },
): void {
  if (!Array.isArray(record.versionHistory) || record.versionHistory.length === 0) {
    return;
  }

  const entry = record.versionHistory[0] as TemplateHistoryEntry;
  entry.action = 'ADOPTED';
  entry.title = `Adopted org template ${formatTemplateVersionLabel(params.toVersion)}`;
  entry.changes = [
    `adopted: ${params.sourceOrgTemplateId} ${formatTemplateVersionLabel(params.fromVersion)} → ${formatTemplateVersionLabel(params.toVersion)}`,
  ];
  entry.updatedBy = normalizeTemplateActor(params.actor) ?? entry.updatedBy;
}
