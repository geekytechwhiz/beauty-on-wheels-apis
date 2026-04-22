import { ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { parsePatchStatusBody, patchTypeStatus } from '../services/metadataService';

export const main = withLambdaHandler(
  async (req: {
    params?: Record<string, string>;
    pathParameters?: { metadataTypeCode?: string };
    body?: { status?: string };
    context?: { userContext?: { userId?: string } };
  }) => {
    const code = req.params?.metadataTypeCode ?? req.pathParameters?.metadataTypeCode;
    if (!code) {
      throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
    }
    const status = parsePatchStatusBody(req.body?.status);
    return patchTypeStatus(code, status, req.context?.userContext?.userId);
  },
  { useCreated: false },
);
