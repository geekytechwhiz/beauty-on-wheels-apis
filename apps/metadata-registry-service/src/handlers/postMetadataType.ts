import { ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import type { MetadataTypeInput } from '@api-hub/metadata';
import { normalizeMetadataTypeInput, upsertMetadataType } from '../services/metadataService';

export const main = withLambdaHandler(
  async (req: { body?: MetadataTypeInput; context?: { userContext?: { userId?: string } } }) => {
    const body = req.body;
    if (!body?.metadataTypeCode) {
      throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
    }
    const userId = req.context?.userContext?.userId;
    return upsertMetadataType(normalizeMetadataTypeInput(body as MetadataTypeInput & Record<string, unknown>), userId);
  },
  { useCreated: false },
);
