import { STATUS } from '../constants';
import type { MetadataTypeRecord } from '../models/types';
import { ValidationError } from '../domain/errors';
import { validateValueRelationshipsPayload } from './metadata-value-relation.service';

const baseType = (): MetadataTypeRecord => ({
  metadataTypeCode: 'State',
  version: 1,
  displayName: 'State',
  valueDataType: 'Enum',
  multiSelectAllowed: false,
  applicableModules: [],
  supportsRelations: true,
  relationFieldLabel: 'Parent',
  targetMetadataTypeCode: 'Country',
  selectionMode: 'SINGLE',
  relationRequired: true,
  relationType: 'PARENT_CHILD',
  status: STATUS.ACTIVE,
  createdAt: 'a',
  lastModifiedAt: 'a',
});

describe('validateValueRelationshipsPayload', () => {
  it('requires relationships on create when relationRequired is true', () => {
    const t = baseType();
    expect(() =>
      validateValueRelationshipsPayload(t, {
        mode: 'create',
        relationshipsSent: false,
        targetCodes: undefined,
      }),
    ).toThrow(ValidationError);
  });

  it('allows PATCH without relationships when relationRequired is true (preserved)', () => {
    const t = baseType();
    expect(() =>
      validateValueRelationshipsPayload(t, {
        mode: 'update',
        relationshipsSent: false,
        targetCodes: undefined,
      }),
    ).not.toThrow();
  });

  it('rejects more than one target in SINGLE mode', () => {
    const t = baseType();
    expect(() =>
      validateValueRelationshipsPayload(t, {
        mode: 'update',
        relationshipsSent: true,
        targetCodes: ['IN', 'US'],
      }),
    ).toThrow(/SINGLE/);
  });
});
