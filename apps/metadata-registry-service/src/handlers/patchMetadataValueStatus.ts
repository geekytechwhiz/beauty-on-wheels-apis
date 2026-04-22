import { ValidationError } from '@api-hub/metadata';
import { STATUS } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { flattenMetadataValueForApi, patchValueStatus } from '../services/metadataService';

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
    const raw = req.body?.status;
    const status =
      raw === undefined || raw === null
        ? undefined
        : (String(raw).trim().toUpperCase() as typeof STATUS.ACTIVE | typeof STATUS.INACTIVE);
    if (status !== STATUS.ACTIVE && status !== STATUS.INACTIVE) {
      throw new ValidationError('status must be ACTIVE or INACTIVE', [{ field: 'status', message: 'Invalid' }]);
    }
    const record = await patchValueStatus(metadataTypeCode, valueCode, status, req.context?.userContext?.userId);
    return flattenMetadataValueForApi(record);
  },
  { useCreated: false },
);
