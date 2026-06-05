import type { RelationType } from '../models/relation-types';
import type { CreateMetadataRelationInput } from '../models/relation-types';
import {
  buildInvalidRelationMappingMessage,
  isGovernedMetadataTypeRelationMappingAllowed,
  RELATION_TYPE_ALLOWED_PAIRS,
} from '../validators/relation';
import { ValidationError } from './errors';

/**
 * Maps UI-facing subject value + chosen target value into persisted relation endpoints (from/to),
 * using catalog edges in {@link RELATION_TYPE_ALLOWED_PAIRS}.
 */
export function resolveRelationStorageEndpoints(
  relationType: RelationType,
  subjectMetadataTypeCode: string,
  subjectValueCode: string,
  targetMetadataTypeCode: string,
  targetValueCode: string,
): CreateMetadataRelationInput {
  if (
    !isGovernedMetadataTypeRelationMappingAllowed(
      relationType,
      subjectMetadataTypeCode,
      targetMetadataTypeCode,
    )
  ) {
    throw new ValidationError(
      buildInvalidRelationMappingMessage(relationType, subjectMetadataTypeCode, targetMetadataTypeCode),
      [
        {
          field: 'relationships',
          message: 'These metadata types cannot be linked for this relation type on this metadata value.',
        },
        {
          field: 'targetMetadataTypeCode',
          message: 'Choose a target metadata type that is allowed for this relation type.',
        },
      ],
    );
  }
  const pairs = RELATION_TYPE_ALLOWED_PAIRS[relationType];
  const forward = pairs.find(
    (p) => p.from === subjectMetadataTypeCode && p.to === targetMetadataTypeCode,
  );
  if (forward) {
    return {
      relationType,
      fromMetadataTypeCode: subjectMetadataTypeCode,
      fromMetadataValueCode: subjectValueCode,
      toMetadataTypeCode: targetMetadataTypeCode,
      toMetadataValueCode: targetValueCode,
    };
  }
  const reverse = pairs.find(
    (p) => p.from === targetMetadataTypeCode && p.to === subjectMetadataTypeCode,
  );
  if (reverse) {
    return {
      relationType,
      fromMetadataTypeCode: targetMetadataTypeCode,
      fromMetadataValueCode: targetValueCode,
      toMetadataTypeCode: subjectMetadataTypeCode,
      toMetadataValueCode: subjectValueCode,
    };
  }
  throw new ValidationError(
    buildInvalidRelationMappingMessage(relationType, subjectMetadataTypeCode, targetMetadataTypeCode),
    [
      {
        field: 'relationships',
        message: 'These metadata types cannot be linked for this relation type on this metadata value.',
      },
      {
        field: 'targetMetadataTypeCode',
        message: 'Choose a target metadata type that is allowed for this relation type.',
      },
    ],
  );
}
