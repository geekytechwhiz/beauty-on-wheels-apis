import axios from 'axios';

import {
  MetadataRegistryClientError,
  MetadataRegistryServiceClient,
} from './metadata-registry-service-client';

jest.mock('../client/axios-client', () => ({
  createHttpClient: jest.fn(() => ({
    defaults: {},
    post: jest.fn(),
  })),
}));

describe('MetadataRegistryServiceClient', () => {
  const originalBaseUrl = process.env.METADATA_REGISTRY_SERVICE_BASE_URL;

  beforeEach(() => {
    process.env.METADATA_REGISTRY_SERVICE_BASE_URL =
      'https://example.execute-api.us-east-1.amazonaws.com/dev';
  });

  afterEach(() => {
    process.env.METADATA_REGISTRY_SERVICE_BASE_URL = originalBaseUrl;
    jest.clearAllMocks();
  });

  it('unwraps the ApiResponse envelope', async () => {
    const client = new MetadataRegistryServiceClient();
    const post = (client as unknown as { client: { post: jest.Mock } }).client.post;
    post.mockResolvedValue({
      status: 200,
      data: {
        success: true,
        statusCode: 200,
        data: {
          items: [
            {
              metadataType: 'Country',
              displayName: 'Country',
              multiSelectAllowed: true,
              valueDataType: 'Enum',
              values: [],
            },
          ],
          missingMetadataTypeCodes: [],
        },
      },
    });

    const result = await client.getValuesByTypes(['Country'], 'Bearer token');

    expect(post).toHaveBeenCalledWith(
      '/metadata/values/by-types',
      { metadataTypeCodes: ['Country'] },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
    expect(result.items).toHaveLength(1);
  });

  it('requires authorization', async () => {
    const client = new MetadataRegistryServiceClient();
    await expect(client.getValuesByTypes(['Country'])).rejects.toBeInstanceOf(
      MetadataRegistryClientError,
    );
  });

  it('surfaces axios failures', async () => {
    const client = new MetadataRegistryServiceClient();
    const post = (client as unknown as { client: { post: jest.Mock } }).client.post;
    post.mockRejectedValue(
      new axios.AxiosError('timeout', 'ECONNABORTED', undefined, undefined, {
        status: 504,
        data: { message: 'Gateway timeout' },
        statusText: 'Gateway Timeout',
        headers: {},
        config: {} as never,
      }),
    );

    await expect(client.getValuesByTypes(['Country'], 'Bearer token')).rejects.toMatchObject({
      statusCode: 504,
    });
  });
});
