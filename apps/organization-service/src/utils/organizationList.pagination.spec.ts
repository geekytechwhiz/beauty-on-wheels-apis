import { describe, expect, it } from '@jest/globals';
import {
  buildOrgListCursorKey,
  decodeOrgListPaginationKey,
  encodeOrgListPaginationKey,
  resolveOrgListPaginationKey,
} from './organizationList.pagination';

describe('organizationList.pagination', () => {
  it('buildOrgListCursorKey extracts Dynamo key attributes', () => {
    expect(
      buildOrgListCursorKey({
        pk: 'ORG#org-1',
        sk: 'DETAILS',
        gsi1pk: 'ORG_LIST',
        gsi1sk: 'ORG#org-1',
        name: 'Acme',
      }),
    ).toEqual({
      pk: 'ORG#org-1',
      sk: 'DETAILS',
      gsi1pk: 'ORG_LIST',
      gsi1sk: 'ORG#org-1',
    });
  });

  it('encodeOrgListPaginationKey round-trips through decodeOrgListPaginationKey', () => {
    const key = {
      pk: 'ORG#org-1',
      sk: 'DETAILS',
      gsi1pk: 'ORG_LIST',
      gsi1sk: 'ORG#org-1',
    };
    const token = encodeOrgListPaginationKey(key);
    expect(token).toBeTruthy();
    expect(decodeOrgListPaginationKey(token!)).toEqual(key);
  });

  it('resolveOrgListPaginationKey prefers nextPaginationKey', () => {
    expect(
      resolveOrgListPaginationKey({
        nextPaginationKey: 'abc123',
        lastEvaluatedKey: { pk: 'ORG#org-1', sk: 'DETAILS' },
      }),
    ).toBe('abc123');
  });

  it('resolveOrgListPaginationKey encodes object lastEvaluatedKey', () => {
    const key = { pk: 'ORG#org-1', sk: 'DETAILS', gsi1pk: 'ORG_LIST', gsi1sk: 'ORG#org-1' };
    const token = resolveOrgListPaginationKey({ lastEvaluatedKey: key });
    expect(decodeOrgListPaginationKey(token!)).toEqual(key);
  });
});
