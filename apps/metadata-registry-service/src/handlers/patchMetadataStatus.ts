import {
  flattenMetadataValueForApi,
  parsePatchStatusBody,
  patchTypeStatus,
  patchValueStatus,
} from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { patchMetadataStatusSchema } from '../schemas/patchMetadataStatus.schema';

export const main = withLambdaHandler(
  async (req) => {
    const input = patchMetadataStatusSchema.parse(req);

    if (input.entityType === 'type') {
      const status = parsePatchStatusBody(input.rawStatus);
      return patchTypeStatus(input.metadataTypeCode, status, input.userId);
    }

    const status = parsePatchStatusBody(input.rawStatus);
    const record = await patchValueStatus(
      input.metadataTypeCode,
      input.valueCode,
      status,
      input.userId,
    );
    return flattenMetadataValueForApi(record);
  },
);
