import { getMetadataValuesByTypes } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';

import { metadataValuesByTypesSchema } from '../schemas/metadataValuesByTypes.schema';

/**
 * POST `/metadata/values/by-types` — batch read of metadata type details plus active values for
 * each requested `metadataTypeCode`. Read-only consumer API; does not change the single-type GET/list contracts.
 */
export const main = withLambdaHandler(async (req) => {
  const { metadataTypeCodes } = metadataValuesByTypesSchema.parse(req);
  return getMetadataValuesByTypes(metadataTypeCodes);
});
