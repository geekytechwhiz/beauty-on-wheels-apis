import type { IMetadataRegistryRepository } from '../repository/metadata-registry.repository.interface';
import { NotFoundError, ValidationError } from '../domain/errors';
import type { CreateMetadataRelationInput, RelationType } from '../domain/relation-types';
import { RELATION_TYPES } from '../domain/relation-types';
import { assertMetadataTypeCode, assertMetadataValueCode } from './code-patterns';
import { skPrefixForRelationType } from '../domain/relation-keys';

const RELATION_TYPE_SET = new Set<string>(RELATION_TYPES);

/**
 * Enforced (fromType, toType) edges per public relationType. Adjust as the catalog grows.
 * Direction is from → to (Dynamo `PK` = from, `SK` = …#toType#toValue).
 */
export const RELATION_TYPE_ALLOWED_PAIRS: Record<RelationType, { from: string; to: string }[]> = {
  PARENT_CHILD: [
    { from: 'Country', to: 'State' },
    { from: 'Category', to: 'Condition' },
  ],
  VALID_IN: [{ from: 'Currency', to: 'Country' }],
  SUPPORTED_BY: [{ from: 'Device', to: 'Vital' }],
  BELONGS_TO_CATEGORY: [{ from: 'Condition', to: 'Category' }],
};

function isPairAllowed(
  relationType: RelationType,
  fromMetadataTypeCode: string,
  toMetadataTypeCode: string,
): boolean {
  const list = RELATION_TYPE_ALLOWED_PAIRS[relationType];
  return list.some((p) => p.from === fromMetadataTypeCode && p.to === toMetadataTypeCode);
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
      `This relationType does not support from "${input.fromMetadataTypeCode}" to "${input.toMetadataTypeCode}"`,
      [
        { field: 'fromMetadataTypeCode', message: 'Incompatible with relationType and toType' },
        { field: 'toMetadataTypeCode', message: 'Incompatible with relationType and fromType' },
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
 * Resolves when both type rows and latest value rows exist; otherwise {@link NotFoundError}.
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
