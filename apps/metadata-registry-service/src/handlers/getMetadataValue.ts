import { NotFoundError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { flattenMetadataValueForApi, getValue } from '../services/metadataService';

function p(req: { params?: Record<string, string>; pathParameters?: Record<string, string> }) {
  return {
    metadataTypeCode: req.params?.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '',
    valueCode: req.params?.metadataValueCode ?? req.pathParameters?.metadataValueCode ?? '',
  };
}

export const main = withLambdaHandler(
  async (req: { params?: Record<string, string>; pathParameters?: Record<string, string> }) => {
    const { metadataTypeCode, valueCode } = p(req);
    if (!metadataTypeCode || !valueCode) {
      throw new NotFoundError('metadataTypeCode and metadataValueCode are required');
    }
    const v = await getValue(metadataTypeCode, valueCode);
    if (!v) {
      throw new NotFoundError(`Value ${valueCode} not found`);
    }
    return flattenMetadataValueForApi(v);
  },
  { useCreated: false },
);
