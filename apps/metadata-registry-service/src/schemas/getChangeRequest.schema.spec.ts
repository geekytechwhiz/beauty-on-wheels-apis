import { ValidationError } from '@api-hub/metadata';
import { getChangeRequestSchema } from './getChangeRequest.schema';

const VALID_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('getChangeRequestSchema', () => {
  it('parses changeRequestId from path parameters', () => {
    const input = getChangeRequestSchema.parse({
      pathParameters: { changeRequestId: VALID_ULID },
    });
    expect(input.changeRequestId).toBe(VALID_ULID);
  });

  it('parses userId from request context (auth pattern)', () => {
    const input = getChangeRequestSchema.parse({
      pathParameters: { changeRequestId: VALID_ULID },
      context: { userContext: { userId: 'admin-user' } },
    });
    expect(input.userId).toBe('admin-user');
  });

  it('rejects missing changeRequestId', () => {
    expect(() => getChangeRequestSchema.parse({ pathParameters: {} })).toThrow(ValidationError);
  });

  it('rejects invalid changeRequestId format', () => {
    expect(() =>
      getChangeRequestSchema.parse({
        pathParameters: { changeRequestId: 'not-a-ulid' },
      }),
    ).toThrow(ValidationError);
  });
});
