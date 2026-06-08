import { extractRegistryEntityPath, ValidationError } from '@api-hub/metadata';
import { postMetadataSchema } from '../schemas/postMetadata.schema';

const typeBody = {
  metadataTypeCode: 'MetricCode',
  displayName: 'Metric',
  valueDataType: 'Enum',
  multiSelectAllowed: false,
  status: 'ACTIVE',
};

const valueBody = {
  metadataTypeCode: 'MetricCode',
  metadataValueCode: 'BP_SYSTOLIC',
  label: 'BP',
};

describe('postMetadataSchema action query param', () => {
  it('parses action=draft from merged query params', () => {
    const input = postMetadataSchema.parse({
      pathParameters: { entityType: 'value' },
      params: { action: 'draft' },
      body: valueBody,
      context: { userContext: { userId: 'admin' } },
    });
    expect(input.action).toBe('draft');
    expect(input.entityType).toBe('value');
    expect(input.userId).toBe('admin');
  });

  it('parses action=impact-preview with metadata body', () => {
    const input = postMetadataSchema.parse({
      pathParameters: { entityType: 'value' },
      params: { action: 'impact-preview' },
      body: valueBody,
    });
    expect(input.action).toBe('impact-preview');
  });

  it('parses action=impact-preview with changeRequestId only', () => {
    const input = postMetadataSchema.parse({
      pathParameters: { entityType: 'value' },
      params: { action: 'impact-preview' },
      body: { changeRequestId: 'cr_abc123' },
    });
    expect(input.action).toBe('impact-preview');
    expect(input.body).toEqual({ changeRequestId: 'cr_abc123' });
  });

  it('rejects POST when action query param is absent', () => {
    expect(() =>
      postMetadataSchema.parse({
        pathParameters: { entityType: 'type' },
        params: {},
        body: typeBody,
      }),
    ).toThrow(ValidationError);
  });

  it('rejects unknown action values', () => {
    expect(() =>
      postMetadataSchema.parse({
        pathParameters: { entityType: 'value' },
        params: { action: 'upsert' },
        body: valueBody,
      }),
    ).toThrow(ValidationError);
  });

  it('parses action=publish with full publish body', () => {
    const input = postMetadataSchema.parse({
      pathParameters: { entityType: 'value' },
      params: { action: 'publish' },
      body: {
        changeRequestId: 'cr_abc123',
        confirmationAcknowledged: true,
        expectedBaseVersion: 3,
      },
    });
    expect(input.action).toBe('publish');
    expect(input.body).toEqual({
      changeRequestId: 'cr_abc123',
      confirmationAcknowledged: true,
      expectedBaseVersion: 3,
    });
  });

  it('requires full publish body fields', () => {
    expect(() =>
      postMetadataSchema.parse({
        pathParameters: { entityType: 'type' },
        params: { action: 'publish' },
        body: { changeRequestId: 'cr_abc123' },
      }),
    ).toThrow(ValidationError);
  });

  it('requires metadata body fields for stateless impact-preview', () => {
    expect(() =>
      postMetadataSchema.parse({
        pathParameters: { entityType: 'type' },
        params: { action: 'impact-preview' },
        body: {},
      }),
    ).toThrow(ValidationError);
  });
});

describe('extractRegistryEntityPath', () => {
  it('reads entityType from path parameters', () => {
    expect(extractRegistryEntityPath({}, { entityType: 'value' }).kind).toBe('value');
  });
});
