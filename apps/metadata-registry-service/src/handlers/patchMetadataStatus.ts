import {
  flattenMetadataValueForApi,
  parsePatchStatusBody,
  patchTypeStatus,
  patchValueStatus,
  ValidationError,
} from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/middleware';
import { patchMetadataStatusSchema } from '../schemas/patchMetadataStatus.schema';

export const main = withLambdaHandler(
  async (req) => {
    const input = patchMetadataStatusSchema.parse(req);

    if (input.entityType === 'type') {
      const status = parsePatchStatusBody(input.rawStatus);
      return patchTypeStatus(input.metadataTypeCode, status, input.userId);
    }

    if (input.entityType === 'value') {
      const status = parsePatchStatusBody(input.rawStatus);
      const record = await patchValueStatus(
        input.metadataTypeCode,
        input.valueCode,
        status,
        input.userId,
      );
      return flattenMetadataValueForApi(record);
    }

    throw new ValidationError('entityType must be "type" or "value"', [
      { field: 'entityType', message: 'Must be "type" or "value"' },
    ]);
  },
  { useCreated: false },
);
