import { ValidationError, encodeRelationId, relationPartitionKey, relationSortKey, RELATION_STATUS } from '@api-hub/metadata';

import { patchRelationSchema } from './patchRelation.schema';

describe('patchRelationSchema', () => {
  const pk = relationPartitionKey('Country', 'US');
  const sk = relationSortKey('PARENT_CHILD', 'State', 'CA');
  const id = encodeRelationId(pk, sk);

  it('parses path id and ACTIVE status', () => {
    const out = patchRelationSchema.parse({
      pathParameters: { id },
      body: { status: RELATION_STATUS.ACTIVE },
    });
    expect(out).toEqual({ pk, sk, userId: undefined, status: RELATION_STATUS.ACTIVE });
  });

  it('accepts id from merged params', () => {
    const out = patchRelationSchema.parse({
      params: { id },
      body: { status: RELATION_STATUS.INACTIVE },
    });
    expect(out.status).toBe(RELATION_STATUS.INACTIVE);
  });

  it('rejects missing status', () => {
    expect(() =>
      patchRelationSchema.parse({
        pathParameters: { id },
        body: {},
      }),
    ).toThrow(ValidationError);
  });

  it('rejects missing body', () => {
    expect(() =>
      patchRelationSchema.parse({
        pathParameters: { id },
      }),
    ).toThrow(ValidationError);
  });

  it('rejects invalid status string', () => {
    expect(() =>
      patchRelationSchema.parse({
        pathParameters: { id },
        body: { status: 'DELETED' },
      }),
    ).toThrow(ValidationError);
  });

  it('rejects wrong casing (strict ACTIVE / INACTIVE only)', () => {
    expect(() =>
      patchRelationSchema.parse({
        pathParameters: { id },
        body: { status: 'Active' },
      }),
    ).toThrow(ValidationError);
  });

  it('rejects invalid opaque id', () => {
    expect(() =>
      patchRelationSchema.parse({
        pathParameters: { id: 'not-a-valid-id' },
        body: { status: RELATION_STATUS.ACTIVE },
      }),
    ).toThrow(ValidationError);
  });

  it('rejects empty id', () => {
    expect(() =>
      patchRelationSchema.parse({
        pathParameters: { id: '   ' },
        body: { status: RELATION_STATUS.ACTIVE },
      }),
    ).toThrow(ValidationError);
  });
});
