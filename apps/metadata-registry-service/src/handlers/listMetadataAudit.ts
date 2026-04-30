import { listTypeAudit, listValueAudit, ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { listMetadataAuditSchema } from '../schemas/listMetadataAudit.schema';

export const main = withLambdaHandler(
  async (req) => {
    const input = listMetadataAuditSchema.parse(req);

    if (input.entityType === 'type') {
      return listTypeAudit(input.metadataTypeCode);
    }

    if (input.entityType === 'value') {
      return listValueAudit(input.metadataTypeCode, input.valueCode);
    }

    throw new ValidationError('entityType must be "type" or "value"', [
      { field: 'entityType', message: 'Must be "type" or "value"' },
    ]);
  },
  { useCreated: false },
);
