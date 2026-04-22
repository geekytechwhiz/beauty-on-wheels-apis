import { ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { flattenMetadataValueForApi, parsePatchStatusBody, patchValueStatus } from '../services/metadataService';

function p(req: { params?: Record<string, string>; pathParameters?: Record<string, string> }) {
  return {
    metadataTypeCode: req.params?.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '',
    valueCode: req.params?.metadataValueCode ?? req.pathParameters?.metadataValueCode ?? '',
  };
}

export const main = withLambdaHandler(
  async (req: {
    params?: Record<string, string>;
    pathParameters?: Record<string, string>;
    body?: { status?: string };
    context?: { userContext?: { userId?: string } };
  }) => {
    const { metadataTypeCode, valueCode } = p(req);
    if (!metadataTypeCode || !valueCode) {
      throw new ValidationError('metadataTypeCode and metadataValueCode are required', [
        { field: 'path', message: 'Required' },
      ]);
    }
    const status = parsePatchStatusBody(req.body?.status);
    const record = await patchValueStatus(metadataTypeCode, valueCode, status, req.context?.userContext?.userId);
    return flattenMetadataValueForApi(record);
  },
  { useCreated: false },
);
