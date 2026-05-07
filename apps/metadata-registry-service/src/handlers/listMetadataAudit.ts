import { listTypeAudit, listValueAudit } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { listMetadataAuditSchema } from '../schemas/listMetadataAudit.schema';

export const main = withLambdaHandler(
  async (req) => {
    const input = listMetadataAuditSchema.parse(req);

    if (input.entityType === 'type') {
      return listTypeAudit(input.metadataTypeCode);
    }

    return listValueAudit(input.metadataTypeCode, input.valueCode);
  },
);
