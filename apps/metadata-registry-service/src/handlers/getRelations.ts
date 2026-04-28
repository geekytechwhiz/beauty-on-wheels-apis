import { withLambdaHandler } from '@api-hub/utils';
import { listRelationsForValue } from '../services/relationService';

export const main = withLambdaHandler(async (req: { params?: Record<string, string> }) => {
  const p = req.params ?? {};
  const fromType = p.fromType ?? p.fromTypeCode ?? '';
  const fromValue = p.fromValue ?? p.fromValueCode ?? '';
  const relationType = p.relationType;
  const toType = p.toType ?? p.toMetadataTypeCode;
  const relations = await listRelationsForValue(fromType, fromValue, { relationType, toType });
  return { relations };
});
