import { metadataTypeUsesSeparateSchemaItem, STATUS } from '../../constants';
import { getMetadataTypeDelta } from '../../domain/type-audit-delta';
import { getMetadataValueDelta } from '../../domain/value-audit-delta';
import { mapFlatAndNestedToApplicability } from '../../mappers/metadata-value-request';
import type { Applicability, MetadataTypeRecord, MetadataValueRecord, Status } from '../../models/types';
import type { ChangeImpactEvaluationInput, DetectedFieldChange } from '../types/change-policy.types';
import {
  APPLICABILITY_CHANGE_KIND,
  CHANGE_POLICY_OPERATION,
  type ChangePolicyOperation,
} from '../types/policy-group.codes';
import {
  classifyListChangeKind,
  resolveEntityAddObjectPath,
  resolveTypeDeltaKeyToObjectPath,
  resolveValueAttributeObjectPath,
  resolveValueAttributesContainerPath,
  resolveValueDeltaKeyToObjectPath,
  VALUE_APPLICABILITY_PATHS,
} from '../resolver/object-path.resolver';

const VALUE_APPLIC_FLAT_KEYS = Object.keys(VALUE_APPLICABILITY_PATHS);

function normalizeStatus(raw: unknown, fallback: Status = STATUS.ACTIVE): Status {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const upper = String(raw).trim().toUpperCase();
  if (upper === STATUS.ACTIVE || upper === STATUS.INACTIVE || upper === STATUS.DELETED) {
    return upper;
  }
  return fallback;
}

function payloadToValueRecord(metadataTypeCode: string, payload: Record<string, unknown>): MetadataValueRecord {
  const now = '1970-01-01T00:00:00.000Z';
  const applicability = mapFlatAndNestedToApplicability(payload);
  const attrs = (payload.valueAttributes ?? payload.attributes ?? {}) as Record<string, unknown>;
  return {
    metadataTypeCode,
    valueCode: String(payload.metadataValueCode ?? payload.valueCode ?? ''),
    version: Number(payload.version ?? 1),
    label: String(payload.label ?? ''),
    description: payload.description !== undefined ? String(payload.description) : undefined,
    sortOrder: Number(payload.sortOrder ?? 0),
    status: normalizeStatus(payload.status),
    isGlobal: Boolean(payload.isGlobal ?? false),
    attributes: { ...attrs },
    applicability,
    applSkKeys: [],
    createdAt: now,
    lastModifiedAt: now,
  };
}

function payloadToTypeRecord(payload: Record<string, unknown>): MetadataTypeRecord {
  const now = '1970-01-01T00:00:00.000Z';
  const modules = Array.isArray(payload.applicableModules)
    ? payload.applicableModules.map(String)
    : [];
  return {
    metadataTypeCode: String(payload.metadataTypeCode ?? ''),
    version: Number(payload.version ?? payload.schemaVersion ?? 1),
    displayName: String(payload.displayName ?? ''),
    description: payload.description !== undefined ? String(payload.description) : undefined,
    valueDataType: String(payload.valueDataType ?? 'Enum'),
    multiSelectAllowed: Boolean(payload.multiSelectAllowed ?? false),
    applicableModules: modules,
    supportsRelations: Boolean(payload.supportsRelations ?? false),
    relationFieldLabel: (payload.relationFieldLabel as string | null) ?? null,
    targetMetadataTypeCode: (payload.targetMetadataTypeCode as string | null) ?? null,
    selectionMode: (payload.selectionMode as MetadataTypeRecord['selectionMode']) ?? null,
    relationRequired: (payload.relationRequired as boolean | null) ?? null,
    relationType: (payload.relationType as MetadataTypeRecord['relationType']) ?? null,
    attributeSchema: (payload.attributeSchema as Record<string, unknown> | undefined) ?? undefined,
    status: normalizeStatus(payload.status),
    createdAt: now,
    lastModifiedAt: now,
  };
}

function applicabilityNestedFallback(
  baseAppl: Applicability,
  proposedAppl: Partial<Applicability> | undefined,
): Applicability {
  return {
    module: proposedAppl?.module ?? baseAppl.module,
    category: proposedAppl?.category ?? baseAppl.category,
    condition: proposedAppl?.condition ?? baseAppl.condition,
    country: proposedAppl?.country ?? baseAppl.country,
    language: proposedAppl?.language ?? baseAppl.language,
  };
}

/** Keeps flat Figma fields aligned with merged nested applicability for delta detection. */
function syncApplicabilityFlatFields(merged: Record<string, unknown>, applicability: Applicability): void {
  merged.applicableModules = [...applicability.module];
  merged.applicableCategories = [...applicability.category];
  merged.applicableConditions = [...applicability.condition];
  merged.applicableCountries = [...applicability.country];
  merged.applicableLanguages = [...(applicability.language ?? [])];
}

function mergeValuePayload(
  base: Record<string, unknown> | null,
  proposed: Record<string, unknown>,
): Record<string, unknown> {
  if (!base) {
    return { ...proposed };
  }
  const merged = { ...base, ...proposed };
  if (proposed.valueAttributes || proposed.attributes) {
    merged.valueAttributes = {
      ...((base.valueAttributes ?? base.attributes ?? {}) as Record<string, unknown>),
      ...((proposed.valueAttributes ?? proposed.attributes ?? {}) as Record<string, unknown>),
    };
  }
  if (proposed.applicability || VALUE_APPLIC_FLAT_KEYS.some((k) => k in proposed)) {
    const baseAppl = mapFlatAndNestedToApplicability(base);
    const proposedAppl = proposed.applicability as Partial<Applicability> | undefined;
    const nestedFallback = applicabilityNestedFallback(baseAppl, proposedAppl);
    merged.applicability = mapFlatAndNestedToApplicability(proposed, nestedFallback);
    syncApplicabilityFlatFields(merged, merged.applicability as Applicability);
  }
  return merged;
}

function mergeTypePayload(
  base: Record<string, unknown> | null,
  proposed: Record<string, unknown>,
): Record<string, unknown> {
  if (!base) {
    return { ...proposed };
  }
  return { ...base, ...proposed };
}

function resolveStatusOperation(baseStatus: Status, proposedStatus: Status): ChangePolicyOperation {
  if (proposedStatus === STATUS.INACTIVE && baseStatus === STATUS.ACTIVE) {
    return CHANGE_POLICY_OPERATION.INACTIVATE;
  }
  if (proposedStatus === STATUS.DELETED && baseStatus !== STATUS.DELETED) {
    return CHANGE_POLICY_OPERATION.RETIRE;
  }
  return CHANGE_POLICY_OPERATION.UPDATE;
}

function pushUniqueChange(changes: DetectedFieldChange[], change: DetectedFieldChange): void {
  const exists = changes.some(
    (c) =>
      c.objectPath === change.objectPath &&
      c.operation === change.operation &&
      c.changeKind === change.changeKind &&
      JSON.stringify(c.oldValue) === JSON.stringify(change.oldValue) &&
      JSON.stringify(c.newValue) === JSON.stringify(change.newValue),
  );
  if (!exists) {
    changes.push(change);
  }
}

function detectValueAttributeChanges(
  changes: DetectedFieldChange[],
  metadataTypeCode: string,
  operation: ChangePolicyOperation,
  oldAttrs: Record<string, unknown> | undefined,
  newAttrs: Record<string, unknown> | undefined,
): void {
  const keys = new Set([...Object.keys(oldAttrs ?? {}), ...Object.keys(newAttrs ?? {})]);
  for (const key of keys) {
    const oldVal = oldAttrs?.[key];
    const newVal = newAttrs?.[key];
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) {
      continue;
    }
    const objectPath = resolveValueAttributeObjectPath(metadataTypeCode, key);
    const changeKind =
      key === 'supportedSourceTypes'
        ? classifyListChangeKind(oldVal, newVal)
        : APPLICABILITY_CHANGE_KIND.ANY;
    pushUniqueChange(changes, {
      objectPath,
      operation,
      changeKind,
      oldValue: oldVal,
      newValue: newVal,
    });
  }
}

function hasNonEmptyObject(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}

/** Emits binding Add paths when the first payload carries explicit binding metadata (template mode TBD). */
function detectValueBindingAddChanges(changes: DetectedFieldChange[], proposed: Record<string, unknown>): void {
  if (proposed.expandableBinding !== undefined) {
    pushUniqueChange(changes, {
      objectPath: 'MetadataValue.ExpandableBinding',
      operation: CHANGE_POLICY_OPERATION.ADD,
      changeKind: APPLICABILITY_CHANGE_KIND.ANY,
      newValue: proposed.expandableBinding,
    });
  }
  if (proposed.fixedTemplateBinding !== undefined) {
    pushUniqueChange(changes, {
      objectPath: 'MetadataValue.FixedTemplateBinding',
      operation: CHANGE_POLICY_OPERATION.ADD,
      changeKind: APPLICABILITY_CHANGE_KIND.ANY,
      newValue: proposed.fixedTemplateBinding,
    });
  }
}

function detectValueAddChanges(
  changes: DetectedFieldChange[],
  metadataTypeCode: string,
  proposed: Record<string, unknown>,
): void {
  pushUniqueChange(changes, {
    objectPath: resolveEntityAddObjectPath('value'),
    operation: CHANGE_POLICY_OPERATION.ADD,
    changeKind: APPLICABILITY_CHANGE_KIND.ANY,
    newValue: proposed.metadataValueCode ?? proposed.valueCode,
  });

  detectValueBindingAddChanges(changes, proposed);

  if (!metadataTypeUsesSeparateSchemaItem(metadataTypeCode)) {
    return;
  }

  const attrs = (proposed.valueAttributes ?? proposed.attributes) as Record<string, unknown> | undefined;
  if (!hasNonEmptyObject(attrs)) {
    return;
  }

  pushUniqueChange(changes, {
    objectPath: resolveValueAttributesContainerPath(metadataTypeCode),
    operation: CHANGE_POLICY_OPERATION.ADD,
    changeKind: APPLICABILITY_CHANGE_KIND.ANY,
    newValue: attrs,
  });
  detectValueAttributeChanges(changes, metadataTypeCode, CHANGE_POLICY_OPERATION.ADD, {}, attrs);
}

function detectTypeAddChanges(changes: DetectedFieldChange[], proposed: Record<string, unknown>): void {
  pushUniqueChange(changes, {
    objectPath: resolveEntityAddObjectPath('type'),
    operation: CHANGE_POLICY_OPERATION.ADD,
    changeKind: APPLICABILITY_CHANGE_KIND.ANY,
    newValue: proposed.metadataTypeCode,
  });

  const schema = proposed.attributeSchema;
  if (hasNonEmptyObject(schema)) {
    pushUniqueChange(changes, {
      objectPath: 'MetadataType.AttributeSchema',
      operation: CHANGE_POLICY_OPERATION.ADD,
      changeKind: APPLICABILITY_CHANGE_KIND.ANY,
      newValue: schema,
    });
  }
}

function detectValueUpdateChanges(
  changes: DetectedFieldChange[],
  metadataTypeCode: string,
  base: Record<string, unknown>,
  proposed: Record<string, unknown>,
): void {
  const before = payloadToValueRecord(metadataTypeCode, base);
  const after = payloadToValueRecord(metadataTypeCode, mergeValuePayload(base, proposed));
  const { oldValue, newValue } = getMetadataValueDelta(before, after);

  for (const key of Object.keys({ ...oldValue, ...newValue })) {
    if (key === 'valueAttributes') {
      detectValueAttributeChanges(
        changes,
        metadataTypeCode,
        CHANGE_POLICY_OPERATION.UPDATE,
        oldValue.valueAttributes as Record<string, unknown> | undefined,
        newValue.valueAttributes as Record<string, unknown> | undefined,
      );
      continue;
    }

    const objectPath = resolveValueDeltaKeyToObjectPath(metadataTypeCode, key);
    if (!objectPath) {
      continue;
    }

    const oldV = oldValue[key];
    const newV = newValue[key];
    let operation: ChangePolicyOperation = CHANGE_POLICY_OPERATION.UPDATE;
    if (objectPath === 'MetadataValue.Status') {
      operation = resolveStatusOperation(before.status, after.status);
    }

    const changeKind = VALUE_APPLIC_FLAT_KEYS.includes(key)
      ? classifyListChangeKind(oldV, newV)
      : APPLICABILITY_CHANGE_KIND.ANY;

    pushUniqueChange(changes, {
      objectPath,
      operation,
      changeKind,
      oldValue: oldV,
      newValue: newV,
    });
  }
}

function detectTypeUpdateChanges(
  changes: DetectedFieldChange[],
  base: Record<string, unknown>,
  proposed: Record<string, unknown>,
): void {
  const before = payloadToTypeRecord(base);
  const after = payloadToTypeRecord(mergeTypePayload(base, proposed));
  const { oldValue, newValue } = getMetadataTypeDelta(before, after);

  const relationChanged = [...TYPE_RELATION_DELTA_KEYS].some((k) => k in oldValue || k in newValue);
  if (relationChanged) {
    pushUniqueChange(changes, {
      objectPath: 'MetadataType.RelationConfig',
      operation: CHANGE_POLICY_OPERATION.UPDATE,
      changeKind: APPLICABILITY_CHANGE_KIND.ANY,
      oldValue: pickRelationSnapshot(oldValue),
      newValue: pickRelationSnapshot(newValue),
    });
  }

  for (const key of Object.keys({ ...oldValue, ...newValue })) {
    if (TYPE_RELATION_DELTA_KEYS.has(key)) {
      continue;
    }
    const objectPath = resolveTypeDeltaKeyToObjectPath(key);
    if (!objectPath || objectPath === 'MetadataType.RelationConfig') {
      continue;
    }

    const oldV = oldValue[key];
    const newV = newValue[key];
    let operation: ChangePolicyOperation = CHANGE_POLICY_OPERATION.UPDATE;
    if (objectPath === 'MetadataType.Status') {
      operation = resolveStatusOperation(before.status, after.status);
    }

    const changeKind =
      key === 'applicableModules' ? classifyListChangeKind(oldV, newV) : APPLICABILITY_CHANGE_KIND.ANY;

    pushUniqueChange(changes, {
      objectPath,
      operation,
      changeKind,
      oldValue: oldV,
      newValue: newV,
    });
  }
}

const TYPE_RELATION_DELTA_KEYS = new Set([
  'supportsRelations',
  'relationFieldLabel',
  'targetMetadataTypeCode',
  'selectionMode',
  'relationRequired',
  'relationType',
]);

function pickRelationSnapshot(delta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of TYPE_RELATION_DELTA_KEYS) {
    if (key in delta) {
      out[key] = delta[key];
    }
  }
  return out;
}

/**
 * Compares base published payload vs proposed payload and emits governed object-path changes.
 * Reuses audit delta helpers for consistent field detection.
 */
export function detectFieldChanges(input: ChangeImpactEvaluationInput): DetectedFieldChange[] {
  const changes: DetectedFieldChange[] = [];
  const { entityType, metadataTypeCode, basePayload, proposedPayload, workflowOperation } = input;

  if (workflowOperation === CHANGE_POLICY_OPERATION.ADD || basePayload === null) {
    if (entityType === 'value') {
      detectValueAddChanges(changes, metadataTypeCode, proposedPayload);
    } else {
      detectTypeAddChanges(changes, proposedPayload);
    }
    return changes;
  }

  if (entityType === 'value') {
    detectValueUpdateChanges(changes, metadataTypeCode, basePayload, proposedPayload);
  } else {
    detectTypeUpdateChanges(changes, basePayload, proposedPayload);
  }

  return changes;
}
