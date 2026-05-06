import {
  metadataService,
  ValidationError
} from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/middleware';
import { listMetadataSchema } from '../schemas/listMetadata.schema';

export const main = withLambdaHandler(async (req) => {
  const input = listMetadataSchema.parse(req);

  if (input.entityType === 'type') {
    return metadataService.listTypes(input);
  }

  if (input.entityType === 'value') {
    return metadataService.listValues(input);
  }

  throw new ValidationError('entityType must be "type" or "value"', [
    { field: 'entityType', message: 'Must be "type" or "value"' },
  ]);
});
