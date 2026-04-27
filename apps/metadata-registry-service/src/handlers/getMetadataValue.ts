import { NotFoundError, STATUS } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { flattenMetadataValueForApi, getValue, parseGetEntityStatusMode } from '../services/metadataService';

function p(req: { params?: Record<string, string>; pathParameters?: Record<string, string> }) {
  return {
    metadataTypeCode: req.params?.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '',
    valueCode: req.params?.metadataValueCode ?? req.pathParameters?.metadataValueCode ?? '',
  };
}

export const main = withLambdaHandler(
  async (req: { params?: Record<string, string>; pathParameters?: Record<string, string> }) => {
    const q = req.params ?? {};
    const { metadataTypeCode, valueCode } = p(req);
    if (!metadataTypeCode || !valueCode) {
      throw new NotFoundError('metadataTypeCode and metadataValueCode are required');
    }
    const mode = parseGetEntityStatusMode(q);
    const v = await getValue(metadataTypeCode, valueCode);
    if (!v) {
      throw new NotFoundError(`Value ${valueCode} not found`);
    }
    if (mode === 'all') {
      return flattenMetadataValueForApi(v);
    }
    if (mode === 'inactive') {
      if (v.status !== STATUS.INACTIVE) {
        throw new NotFoundError(`Value ${valueCode} not found`);
      }
      return flattenMetadataValueForApi(v);
    }
    if (v.status !== STATUS.ACTIVE) {
      throw new NotFoundError(`Value ${valueCode} not found`);
    }
    return flattenMetadataValueForApi(v);
  },
  { useCreated: false },
);
