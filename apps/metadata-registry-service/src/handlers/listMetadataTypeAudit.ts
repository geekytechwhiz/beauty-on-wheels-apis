import { ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { listTypeAudit } from '../services/metadataService';

export const main = withLambdaHandler(
  async (req: { params?: Record<string, string>; pathParameters?: Record<string, string> }) => {
    const metadataTypeCode = req.params?.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '';
    if (!metadataTypeCode) {
      throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
    }
    return listTypeAudit(metadataTypeCode);
  },
  { useCreated: false },
);
