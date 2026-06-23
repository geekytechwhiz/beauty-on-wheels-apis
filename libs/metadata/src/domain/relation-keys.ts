import type { RelationType } from '../models/relation-types';

const REL = 'RELATION' as const;

/**
 * `PK = RELATION#<fromMetadataTypeCode>#<fromMetadataValueCode>` — forward only (reverse lookup is out of scope for v1).
 */
export function relationPartitionKey(fromMetadataTypeCode: string, fromMetadataValueCode: string): string {
  return `${REL}#${fromMetadataTypeCode}#${fromMetadataValueCode}`;
}

/** Maps public relationType to DynamoDB `SK` prefix segment. */
export function skPrefixForRelationType(relationType: RelationType): string {
  switch (relationType) {
    case 'PARENT_CHILD':
      return 'CHILD';
    case 'VALID_IN':
      return 'VALID_IN';
    case 'SUPPORTED_BY':
      return 'SUPPORTS';
    case 'BELONGS_TO_CATEGORY':
      return 'BELONGS';
    case 'ALLOWED_FOR':
      return 'ALLOWED_FOR';
    default: {
      const _exhaustive: never = relationType;
      return _exhaustive;
    }
  }
}

/**
 * `SK = <SkPrefix>#<toMetadataTypeCode>#<toMetadataValueCode>`.
 * Value codes must not contain `#` (enforced at API validation).
 */
export function relationSortKey(
  relationType: RelationType,
  toMetadataTypeCode: string,
  toMetadataValueCode: string,
): string {
  const p = skPrefixForRelationType(relationType);
  return `${p}#${toMetadataTypeCode}#${toMetadataValueCode}`;
}

const SK_PREFIXES = new Set<string>(['CHILD', 'VALID_IN', 'SUPPORTS', 'BELONGS', 'ALLOWED_FOR']);

export interface ParsedRelationSortKey {
  skPrefix: string;
  toMetadataTypeCode: string;
  toMetadataValueCode: string;
}

/**
 * Parse stored relation `SK`; returns null if the string is not a valid relation `SK`.
 */
export function parseRelationSortKey(sk: string): ParsedRelationSortKey | null {
  const parts = sk.split('#');
  if (parts.length < 3) {
    return null;
  }
  const skPrefix = parts[0] ?? '';
  if (!SK_PREFIXES.has(skPrefix)) {
    return null;
  }
  const toMetadataTypeCode = parts[1] ?? '';
  const toMetadataValueCode = parts.slice(2).join('#');
  if (!toMetadataTypeCode || !toMetadataValueCode) {
    return null;
  }
  return { skPrefix, toMetadataTypeCode, toMetadataValueCode };
}

export function relationTypeFromSkPrefix(skPrefix: string): RelationType | null {
  switch (skPrefix) {
    case 'CHILD':
      return 'PARENT_CHILD';
    case 'VALID_IN':
      return 'VALID_IN';
    case 'SUPPORTS':
      return 'SUPPORTED_BY';
    case 'BELONGS':
      return 'BELONGS_TO_CATEGORY';
    case 'ALLOWED_FOR':
      return 'ALLOWED_FOR';
    default:
      return null;
  }
}

function base64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function base64urlDecode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

/** Opaque id for `PATCH /metadata/relations/{id}` (URL-safe, encodes full primary key). */
export function encodeRelationId(pk: string, sk: string): string {
  return base64urlEncode(JSON.stringify({ pk, sk }));
}

export function decodeRelationId(id: string): { pk: string; sk: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(base64urlDecode(id));
  } catch {
    throw new Error('Invalid relation id');
  }
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('pk' in raw) ||
    !('sk' in raw) ||
    typeof (raw as { pk: unknown }).pk !== 'string' ||
    typeof (raw as { sk: unknown }).sk !== 'string'
  ) {
    throw new Error('Invalid relation id');
  }
  return { pk: (raw as { pk: string }).pk, sk: (raw as { sk: string }).sk };
}

/**
 * Audit partition for relation events: `PATCH` inactivate, etc.
 * Query with `begins_with(SK, 'TIMESTAMP#')` like other audit streams.
 */
export function auditRelationPartitionKey(
  fromMetadataTypeCode: string,
  fromMetadataValueCode: string,
): string {
  return `AUDIT#METADATA_RELATION#${fromMetadataTypeCode}#${fromMetadataValueCode}`;
}
