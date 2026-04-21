import { ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { listValueAudit } from '../services/metadataService';

export const main = withLambdaHandler(
  async (req: { params?: Record<string, string>; pathParameters?: Record<string, string> }) => {
    const metadataTypeCode = req.params?.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '';
    const valueCode = req.params?.metadataValueCode ?? req.pathParameters?.metadataValueCode ?? '';
    if (!metadataTypeCode || !valueCode) {
      throw new ValidationError('metadataTypeCode and metadataValueCode are required', [
        { field: 'path', message: 'Required' },
      ]);
    }
    return listValueAudit(metadataTypeCode, valueCode);
  },
  { useCreated: false },
);
