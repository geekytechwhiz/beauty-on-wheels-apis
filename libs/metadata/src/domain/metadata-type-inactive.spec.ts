import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STATUS } from './constants';
import {
  assertMetadataTypeActiveForValueMutation,
  MetadataTypeInactiveError,
} from './errors';
import type { MetadataTypeRecord } from './types';

function baseType(overrides: Partial<MetadataTypeRecord> = {}): MetadataTypeRecord {
  return {
    metadataTypeCode: 'SampleType',
    version: 1,
    displayName: 'Sample',
    valueDataType: 'Enum',
    multiSelectAllowed: false,
    applicableModules: ['CARE'],
    status: STATUS.ACTIVE,
    createdAt: '2020-01-01T00:00:00.000Z',
    lastModifiedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('MetadataTypeInactiveError', () => {
  it('exposes 409, METADATA_TYPE_INACTIVE, and metadataTypeCode in details', () => {
    const err = new MetadataTypeInactiveError('MyType');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('METADATA_TYPE_INACTIVE');
    expect(err.message).toBe('Cannot create value for inactive metadata type');
    expect(err.details).toEqual([{ field: 'metadataTypeCode', message: 'MyType' }]);
  });
});

describe('assertMetadataTypeActiveForValueMutation', () => {
  it('does not throw when type status is ACTIVE (create / update under active type)', () => {
    expect(() => assertMetadataTypeActiveForValueMutation(baseType(), 'SampleType')).not.toThrow();
  });

  it('throws when type status is INACTIVE (no new value, no new version)', () => {
    const inactive = baseType({ status: STATUS.INACTIVE });
    expect(() => assertMetadataTypeActiveForValueMutation(inactive, 'SampleType')).toThrow(MetadataTypeInactiveError);
  });
});

/**
 * Read paths must not require ACTIVE parent type: values remain readable when the type is inactive.
 * Contract: the guard is only invoked from value create/update/patch in the repository.
 */
describe('read paths vs inactive type (contract)', () => {
  const repoSrc = readFileSync(
    join(__dirname, '..', 'repository', 'dynamodb-metadata.repository.ts'),
    'utf8',
  );

  it('assertMetadataTypeActiveForValueMutation appears exactly on create, update, and patch value status', () => {
    const matches = repoSrc.match(/assertMetadataTypeActiveForValueMutation\(/g) ?? [];
    expect(matches).toHaveLength(3);
  });

  it('getMetadataValue and listMetadataValues do not use the guard (read under inactive type still works)', () => {
    const gmv = '  async getMetadataValue(';
    const lmv = '  async listMetadataValues(';
    const search = '  async searchMetadataValues(';
    const fromGet = repoSrc.indexOf(gmv);
    const toList = repoSrc.indexOf(lmv, fromGet);
    const toSearch = repoSrc.indexOf(search, toList);
    expect(repoSrc.slice(fromGet, toList)).not.toContain('assertMetadataTypeActiveForValueMutation');
    expect(repoSrc.slice(toList, toSearch)).not.toContain('assertMetadataTypeActiveForValueMutation');
  });
});
