import { MetadataRegistryClientError } from '@api-hub/service-clients';
import { BaseError } from '@api-hub/utils';

import { DEFAULT_TEMPLATE_CONFIG_METADATA_TYPE_CODES } from '../constants/template-config-meta.constants';
import { TemplateConfigMetaService } from './template-config-meta.service';

describe('TemplateConfigMetaService', () => {
  it('forwards requested metadata type codes to the registry client', async () => {
    const getValuesByTypes = jest.fn().mockResolvedValue({
      items: [],
      missingMetadataTypeCodes: [],
    });
    const service = new TemplateConfigMetaService({ getValuesByTypes } as never);
    const metadataTypeCodes = [...DEFAULT_TEMPLATE_CONFIG_METADATA_TYPE_CODES];

    await service.getMeta({ metadataTypeCodes, authHeader: 'Bearer token' });

    expect(getValuesByTypes).toHaveBeenCalledWith(metadataTypeCodes, 'Bearer token');
  });

  it('maps upstream client errors to BaseError', async () => {
    const getValuesByTypes = jest
      .fn()
      .mockRejectedValue(new MetadataRegistryClientError('upstream failed', 503));
    const service = new TemplateConfigMetaService({ getValuesByTypes } as never);

    await expect(service.getMeta({ authHeader: 'Bearer token' })).rejects.toBeInstanceOf(
      BaseError,
    );
  });
});
