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

  it('rejects impact-preview and publish until implemented', () => {
    for (const action of ['impact-preview', 'publish'] as const) {
      expect(() =>
        postMetadataSchema.parse({
          pathParameters: { entityType: 'type' },
          params: { action },
          body: typeBody,
        }),
      ).toThrow(ValidationError);
    }
  });
});

describe('extractRegistryEntityPath', () => {
  it('reads entityType from path parameters', () => {
    expect(extractRegistryEntityPath({}, { entityType: 'value' }).kind).toBe('value');
  });
});
