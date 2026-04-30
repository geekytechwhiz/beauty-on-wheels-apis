import { withLambdaHandler } from '@api-hub/middleware';
import { listRelatedValues } from '../services/relationService';

/**
 * Returns `{ values: RelatedValueRef[] }` so top-level `data` is an object, not a raw array
 * (avoids `normalizeData` turning arrays into `{ items }` only for this list endpoint).
 */
export const main = withLambdaHandler(async (req: { params?: Record<string, string> }) => {
  const p = req.params ?? {};
  const fromType = p.fromType ?? '';
  const fromValue = p.fromValue ?? '';
  const relationType = p.relationType;
  const toType = p.toType ?? p.toMetadataTypeCode;
  const values = await listRelatedValues(fromType, fromValue, { relationType, toType });
  return { values };
});
