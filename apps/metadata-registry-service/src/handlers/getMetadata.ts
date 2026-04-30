import {
  resolveMetadataTypeGet,
  resolveMetadataValueGetForApi,
  ValidationError,
} from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { getMetadataSchema } from '../schemas/getMetadata.schema';

export const main = withLambdaHandler(async (req) => {
  const input = getMetadataSchema.parse(req);

  if (input.entityType === 'type') {
    return resolveMetadataTypeGet(input.metadataTypeCode, input.mode);
  }

  if (input.entityType === 'value') {
    return resolveMetadataValueGetForApi(input.metadataTypeCode, input.valueCode, input.mode);
  }

  throw new ValidationError('entityType must be "type" or "value"', [
    { field: 'entityType', message: 'Must be "type" or "value"' },
  ]);
});
