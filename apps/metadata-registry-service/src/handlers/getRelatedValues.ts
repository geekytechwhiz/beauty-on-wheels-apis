import { withLambdaHandler } from '@api-hub/utils';
import { listRelatedValuesGrouped } from '../services/relationService';
import { getRelatedValuesSchema } from '../schemas/getRelatedValues.schema';

/**
 * Returns `{ groups: RelatedValuesGroup[] }` so top-level `data` is an object, not a raw
 * array (avoids `normalizeData` turning arrays into `{ items }`). `fromValue` supports a
 * single value, repeated query params, or comma-separated values; results are grouped per
 * source value with labels.
 */
export const main = withLambdaHandler(async (req) => {
  const input = getRelatedValuesSchema.parse(req);
  const groups = await listRelatedValuesGrouped(input.fromType, input.fromValues, {
    relationType: input.relationType,
    toType: input.toType,
  });
  return { groups };
});
