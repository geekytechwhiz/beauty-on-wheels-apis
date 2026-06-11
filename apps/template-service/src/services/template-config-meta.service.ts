import {
  getMetadataRegistryServiceClient,
  MetadataRegistryClientError,
} from '@api-hub/service-clients';
import { BaseError } from '@api-hub/utils';

import { DEFAULT_TEMPLATE_CONFIG_METADATA_TYPE_CODES } from '../constants/template-config-meta.constants';
import {
  mapTemplateConfigMetaResponse,
  type TemplateConfigMetaResponse,
} from '../mappers/template-config-meta.mapper';

export interface GetTemplateConfigMetaParams {
  metadataTypeCodes?: string[];
  authHeader?: string;
}

export class TemplateConfigMetaService {
  constructor(
    private readonly metadataClient = getMetadataRegistryServiceClient(),
  ) {}

  async getMeta(params: GetTemplateConfigMetaParams): Promise<TemplateConfigMetaResponse> {
    const metadataTypeCodes =
      params.metadataTypeCodes?.length
        ? params.metadataTypeCodes
        : [...DEFAULT_TEMPLATE_CONFIG_METADATA_TYPE_CODES];

    try {
      const upstream = await this.metadataClient.getValuesByTypes(
        metadataTypeCodes,
        params.authHeader,
      );
      return mapTemplateConfigMetaResponse(upstream);
    } catch (error) {
      if (error instanceof MetadataRegistryClientError) {
        throw new BaseError(error.message, error.statusCode, error.code, [
          { message: error.message },
        ]);
      }
      throw error;
    }
  }
}

let templateConfigMetaService: TemplateConfigMetaService | undefined;

export function getTemplateConfigMetaService(): TemplateConfigMetaService {
  if (!templateConfigMetaService) {
    templateConfigMetaService = new TemplateConfigMetaService();
  }
  return templateConfigMetaService;
}
