import { ValidationError } from '@api-hub/metadata';
import { STATUS } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { patchTypeStatus } from '../services/metadataService';

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
    const status = req.body?.status;
    if (status !== STATUS.ACTIVE && status !== STATUS.INACTIVE) {
      throw new ValidationError('status must be ACTIVE or INACTIVE', [{ field: 'status', message: 'Invalid' }]);
    }
    return patchTypeStatus(code, status, req.context?.userContext?.userId);
  },
  { useCreated: false },
);
