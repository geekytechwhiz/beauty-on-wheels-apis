import { STATUS } from '../constants';
import type { IMetadataRegistryRepository } from '../repositories/metadata-registry.repository.interface';
import { NotFoundError, ValidationError } from '../domain/errors';
import type { MetadataValueRecord } from '../models/types';
import type { CreateMetadataRelationInput, RelationType } from '../models/relation-types';
import { RELATION_TYPES } from '../models/relation-types';
import { assertMetadataTypeCode, assertMetadataValueCode } from './code-patterns';
import { skPrefixForRelationType } from '../domain/relation-keys';

const RELATION_TYPE_SET = new Set<string>(RELATION_TYPES);

/**
 * Enforced (fromType, toType) edges per public relationType. Adjust as the catalog grows.
 * Direction is from → to (Dynamo `PK` = from, `SK` = …#toType#toValue).
 */
export const RELATION_TYPE_ALLOWED_PAIRS: Record<RelationType, { from: string; to: string }[]> = {
  /**
   * Geographic / containment hierarchy only (parent `from` → child `to` in storage).
   * **Not** for taxonomy (Condition ↔ Category); use {@link RELATION_TYPE_ALLOWED_PAIRS.BELONGS_TO_CATEGORY}.
   *
   * **Migration:** legacy `PARENT_CHILD` rows between `Category` and `Condition` belong on
   * `BELONGS_TO_CATEGORY` with **storage** `from=Category`, `to=Condition` (see matrix below).
   */
  PARENT_CHILD: [
    { from: 'Country', to: 'State' },
    { from: 'State', to: 'City' },
  ],
  /**
   * Canonical storage/catalog edge `Currency` → `Country`. Value sync may still attach relations when the
   * edited subject is `Country` and the target is `Currency` — {@link isGovernedMetadataTypeRelationMappingAllowed}
   * and {@link resolveRelationStorageEndpoints} treat the unordered pair as allowed and orient to this edge.
   */
  VALID_IN: [{ from: 'Currency', to: 'Country' }],
  SUPPORTED_BY: [{ from: 'Device', to: 'Vital' }],
  /**
   * **Storage / API `from`→`to`:** `Category` value is PK owner (`RELATION#Category#<code>`),
   * `SK = BELONGS#Condition#<code>` — list all conditions under a category via `Query` on that PK.
   * Value sync still edits **Condition** values choosing a **Category**; {@link resolveRelationStorageEndpoints}
   * normalizes to this direction (same pattern as `PARENT_CHILD` type rows vs storage).
   *
   * **Data migration:** rows written under `RELATION#Condition#…` / `BELONGS#Category#…` must be rewritten
   * to `RELATION#Category#…` / `BELONGS#Condition#…` (swap `from`/`to` type and value on each item + audit keys).
   */
  BELONGS_TO_CATEGORY: [{ from: 'Category', to: 'Condition' }],
  /** ServiceType value may link to multiple Specialty values (selectionMode MULTI on ServiceType). */
  ALLOWED_FOR: [{ from: 'ServiceType', to: 'Specialty' }],
};

function isPairAllowed(
  relationType: RelationType,
  fromMetadataTypeCode: string,
  toMetadataTypeCode: string,
): boolean {
  const list = RELATION_TYPE_ALLOWED_PAIRS[relationType];
  return list.some((p) => p.from === fromMetadataTypeCode && p.to === toMetadataTypeCode);
}

/**
 * Whether `metadataTypeCode` (subject type whose values carry `relationships`) and
 * `targetMetadataTypeCode` are a permitted pair for `relationType`, in either storage direction.
 *
 * Uses {@link RELATION_TYPE_ALLOWED_PAIRS} only — same source as {@link validateRelationPairing}
 * and {@link resolveRelationStorageEndpoints}.
 */
export function isGovernedMetadataTypeRelationMappingAllowed(
  relationType: RelationType,
  metadataTypeCode: string,
  targetMetadataTypeCode: string,
): boolean {
  return (
    isPairAllowed(relationType, metadataTypeCode, targetMetadataTypeCode) ||
    isPairAllowed(relationType, targetMetadataTypeCode, metadataTypeCode)
  );
}

/**
 * Whether metadata **type** configuration is allowed: values of `metadataTypeCode` may reference
 * `targetMetadataTypeCode` — **strict business direction** only (no reverse of that arrow).
 *
 * Still derived only from {@link RELATION_TYPE_ALLOWED_PAIRS}:
 *
 * - **PARENT_CHILD:** matrix rows are **hierarchy** parent(from) → child(to) for storage (e.g. geography).
 *   Allowed metadata **type** rows are **child → parent**: `(metadataTypeCode, targetMetadataTypeCode) === (p.to, p.from)`.
 * - **VALID_IN:** metadata type rows must match the **canonical** `from`→`to` row in the matrix (single
 *   authoritative business/storage direction). Unordered type pairing for value orchestration still uses
 *   {@link isGovernedMetadataTypeRelationMappingAllowed}.
 * - **BELONGS_TO_CATEGORY:** matrix is **Category → Condition** (storage). Metadata **type** rows where
 *   **Condition** selects **Category** use `(metadataTypeCode, target) === (p.to, p.from)`; either end of the
 *   governed pair is accepted via {@link isGovernedMetadataTypeRelationMappingAllowed}.
 * - **SUPPORTED_BY:** business direction matches the stored edge; forward {@link isPairAllowed} only.
 *
 * For storage orientation / value sync, use {@link isGovernedMetadataTypeRelationMappingAllowed}.
 */
export function isStrictGovernedMetadataTypeRelationConfigAllowed(
  relationType: RelationType,
  metadataTypeCode: string,
  targetMetadataTypeCode: string,
): boolean {
  if (relationType === 'PARENT_CHILD') {
    return RELATION_TYPE_ALLOWED_PAIRS.PARENT_CHILD.some(
      (p) => p.to === metadataTypeCode && p.from === targetMetadataTypeCode,
    );
  }
  if (relationType === 'BELONGS_TO_CATEGORY') {
    return isGovernedMetadataTypeRelationMappingAllowed(
      relationType,
      metadataTypeCode,
      targetMetadataTypeCode,
    );
  }
  return isPairAllowed(relationType, metadataTypeCode, targetMetadataTypeCode);
}

/** Strict-allowed (source metadata type -> target metadata type) pairs derived from the matrix only. */
function listStrictAllowedMappings(relationType: RelationType): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const p of RELATION_TYPE_ALLOWED_PAIRS[relationType]) {
    if (relationType === 'PARENT_CHILD' || relationType === 'BELONGS_TO_CATEGORY') {
      out.push({ from: p.to, to: p.from });
    } else {
      out.push({ from: p.from, to: p.to });
    }
  }
  return out;
}

function allowedStrictTargetsForSubject(
  relationType: RelationType,
  subjectMetadataTypeCode: string,
): string[] {
  const targets = new Set<string>();
  for (const m of listStrictAllowedMappings(relationType)) {
    if (m.from === subjectMetadataTypeCode) {
      targets.add(m.to);
    }
  }
  return [...targets];
}

/**
 * User-facing explanation for a failed metadata-type or value-level type pair (same matrix rules as strict + governed).
 * Does not change validation outcomes — messaging only.
 */
export function buildInvalidRelationMappingMessage(
  relationType: RelationType,
  sourceMetadataTypeCode: string,
  targetMetadataTypeCode: string,
): string {
  const base = `Invalid relation mapping. ${sourceMetadataTypeCode} cannot relate to ${targetMetadataTypeCode} using ${relationType}.`;
  if (isStrictGovernedMetadataTypeRelationConfigAllowed(relationType, sourceMetadataTypeCode, targetMetadataTypeCode)) {
    return base;
  }
  if (isGovernedMetadataTypeRelationMappingAllowed(relationType, sourceMetadataTypeCode, targetMetadataTypeCode)) {
    if (
      isStrictGovernedMetadataTypeRelationConfigAllowed(
        relationType,
        targetMetadataTypeCode,
        sourceMetadataTypeCode,
      )
    ) {
      return `${base} Allowed direction is ${targetMetadataTypeCode} -> ${sourceMetadataTypeCode}.`;
    }
  }
  const targets = allowedStrictTargetsForSubject(relationType, sourceMetadataTypeCode);
  if (targets.length === 1) {
    return `${base} Allowed target metadata type is ${targets[0]}.`;
  }
  if (targets.length > 1) {
    return `${base} Allowed target metadata types are ${targets.join(', ')}.`;
  }
  const otherRelationHints = RELATION_TYPES.filter(
    (rt) =>
      rt !== relationType &&
      isStrictGovernedMetadataTypeRelationConfigAllowed(rt, sourceMetadataTypeCode, targetMetadataTypeCode),
  ).map((rt) => {
    const pairs = listStrictAllowedMappings(rt)
      .filter((m) => m.from === sourceMetadataTypeCode && m.to === targetMetadataTypeCode)
      .map((m) => `${m.from} -> ${m.to}`)
      .join('; ');
    return pairs ? `${rt}: ${pairs}` : rt;
  });
  if (otherRelationHints.length > 0) {
    return `${base} Allowed mappings — ${otherRelationHints.join(' | ')}.`;
  }
  const all = listStrictAllowedMappings(relationType).map((m) => `${m.from} -> ${m.to}`);
  if (all.length > 0) {
    return `${base} Allowed mappings for ${relationType} are: ${all.join('; ')}.`;
  }
  return base;
}

/**
 * Message for {@link validateRelationPairing} when the catalog forward row does not match the requested types.
 * Uses catalog matrix row direction for the correction hint (relation API order).
 */
export function buildInvalidRelationPairingMessage(
  relationType: RelationType,
  firstMetadataTypeCode: string,
  secondMetadataTypeCode: string,
): string {
  const base = `Invalid relation mapping. ${firstMetadataTypeCode} cannot relate to ${secondMetadataTypeCode} using ${relationType}.`;
  if (isPairAllowed(relationType, firstMetadataTypeCode, secondMetadataTypeCode)) {
    return base;
  }
  if (isGovernedMetadataTypeRelationMappingAllowed(relationType, firstMetadataTypeCode, secondMetadataTypeCode)) {
    const hit = RELATION_TYPE_ALLOWED_PAIRS[relationType].find(
      (p) =>
        (p.from === firstMetadataTypeCode && p.to === secondMetadataTypeCode) ||
        (p.from === secondMetadataTypeCode && p.to === firstMetadataTypeCode),
    );
    if (hit) {
      return `${base} Allowed relation mapping is ${hit.from} -> ${hit.to}.`;
    }
  }
  const catalog = RELATION_TYPE_ALLOWED_PAIRS[relationType].map((p) => `${p.from} -> ${p.to}`).join('; ');
  if (catalog.length > 0) {
    return `${base} Allowed mappings for ${relationType} are: ${catalog}.`;
  }
  return base;
}

/**
 * Validates metadata type relation configuration using {@link isStrictGovernedMetadataTypeRelationConfigAllowed}
 * (business-authoritative direction). Storage/value orchestration continues to use
 * {@link isGovernedMetadataTypeRelationMappingAllowed} elsewhere.
 */
export function assertGovernedRelationTypeForTypes(params: {
  relationType: RelationType;
  metadataTypeCode: string;
  targetMetadataTypeCode: string;
}): void {
  const { relationType, metadataTypeCode, targetMetadataTypeCode } = params;
  if (isStrictGovernedMetadataTypeRelationConfigAllowed(relationType, metadataTypeCode, targetMetadataTypeCode)) {
    return;
  }
  throw new ValidationError(buildInvalidRelationMappingMessage(relationType, metadataTypeCode, targetMetadataTypeCode), [
    {
      field: 'relationType',
      message: 'This relation type is not valid for this metadata type and target metadata type combination.',
    },
    {
      field: 'targetMetadataTypeCode',
      message: 'Choose an allowed target metadata type (or swap direction) for this relation type.',
    },
  ]);
}

export function assertValidRelationType(raw: string): RelationType {
  if (!RELATION_TYPE_SET.has(raw)) {
    throw new ValidationError('Invalid relationType', [
      { field: 'relationType', message: `Must be one of: ${RELATION_TYPES.join(', ')}` },
    ]);
  }
  return raw as RelationType;
}

export function validateRelationPairing(input: CreateMetadataRelationInput): void {
  if (!isPairAllowed(input.relationType, input.fromMetadataTypeCode, input.toMetadataTypeCode)) {
    throw new ValidationError(
      buildInvalidRelationPairingMessage(
        input.relationType,
        input.fromMetadataTypeCode,
        input.toMetadataTypeCode,
      ),
      [
        {
          field: 'fromMetadataTypeCode',
          message: 'Use the allowed metadata type and target metadata type order for this relation type.',
        },
        {
          field: 'toMetadataTypeCode',
          message: 'Use the allowed metadata type and target metadata type order for this relation type.',
        },
      ],
    );
  }
}

/**
 * Code-shape validation; call before existence checks.
 */
export function validateRelationRequestShape(input: CreateMetadataRelationInput): void {
  const relationType = assertValidRelationType(String((input as { relationType: unknown }).relationType));
  assertMetadataTypeCode(input.fromMetadataTypeCode, 'fromMetadataTypeCode');
  assertMetadataTypeCode(input.toMetadataTypeCode, 'toMetadataTypeCode');
  assertMetadataValueCode(input.fromMetadataValueCode, 'fromMetadataValueCode');
  assertMetadataValueCode(input.toMetadataValueCode, 'toMetadataValueCode');
  validateRelationPairing({ ...input, relationType });
}

/**
 * Ensures both endpoint metadata values may participate in an **active** relation row
 * (create, reactivate, or sync to ACTIVE). Requires latest value status {@link STATUS.ACTIVE}.
 *
 * {@link STATUS.DELETED} and {@link STATUS.INACTIVE} values are rejected with {@link ValidationError}
 * so historical rows and audit remain intact while new or re-activated linkages stay governed.
 */
export function assertMetadataValuesAllowActiveRelationLinkage(
  input: Pick<
    CreateMetadataRelationInput,
    | 'fromMetadataTypeCode'
    | 'fromMetadataValueCode'
    | 'toMetadataTypeCode'
    | 'toMetadataValueCode'
  >,
  fromVal: MetadataValueRecord,
  toVal: MetadataValueRecord,
): void {
  if (fromVal.status !== STATUS.ACTIVE) {
    const code = input.fromMetadataValueCode;
    const msg =
      fromVal.status === STATUS.DELETED
        ? `Metadata value ${code} is DELETED and cannot be used in relations.`
        : `Metadata value ${code} is INACTIVE and cannot be used in active relations.`;
    throw new ValidationError(msg, [{ field: 'fromMetadataValueCode', message: msg }]);
  }
  if (toVal.status !== STATUS.ACTIVE) {
    const code = input.toMetadataValueCode;
    const msg =
      toVal.status === STATUS.DELETED
        ? `Metadata value ${code} is DELETED and cannot be used in relations.`
        : `Metadata value ${code} is INACTIVE and cannot be used in active relations.`;
    throw new ValidationError(msg, [{ field: 'toMetadataValueCode', message: msg }]);
  }
}

/**
 * Resolves when both type rows and latest value rows exist; otherwise {@link NotFoundError}.
 * Value rows must be {@link STATUS.ACTIVE} for any operation that establishes an active relation.
 */
export async function assertRelationEndpointsExist(
  repo: IMetadataRegistryRepository,
  input: CreateMetadataRelationInput,
): Promise<void> {
  const fromType = await repo.getMetadataType(input.fromMetadataTypeCode);
  if (!fromType) {
    throw new NotFoundError(`Metadata type not found: ${input.fromMetadataTypeCode}`);
  }
  const toType = await repo.getMetadataType(input.toMetadataTypeCode);
  if (!toType) {
    throw new NotFoundError(`Metadata type not found: ${input.toMetadataTypeCode}`);
  }
  const fromVal = await repo.getMetadataValue(
    input.fromMetadataTypeCode,
    input.fromMetadataValueCode,
  );
  if (!fromVal) {
    throw new NotFoundError(
      `Metadata value not found: ${input.fromMetadataTypeCode} / ${input.fromMetadataValueCode}`,
    );
  }
  const toVal = await repo.getMetadataValue(input.toMetadataTypeCode, input.toMetadataValueCode);
  if (!toVal) {
    throw new NotFoundError(
      `Metadata value not found: ${input.toMetadataTypeCode} / ${input.toMetadataValueCode}`,
    );
  }
  assertMetadataValuesAllowActiveRelationLinkage(input, fromVal, toVal);
}

/**
 * Build optional `skBeginsWith` for Dynamo `Query` (narrow reads when possible).
 */
export function skBeginsWithForListFilter(
  relationType?: string,
  toMetadataTypeCode?: string,
): string | undefined {
  if (!relationType) {
    return undefined;
  }
  const rt = assertValidRelationType(relationType);
  const p = skPrefixForRelationType(rt);
  if (toMetadataTypeCode) {
    return `${p}#${toMetadataTypeCode}#`;
  }
  return `${p}#`;
}
