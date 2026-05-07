import type { MetadataTypeInput, MetadataValueInput } from '@api-hub/metadata';
import {
  flattenMetadataValueForApi,
  getValue,
  normalizeMetadataTypeInput,
  normalizeMetadataValueInput,
  upsertMetadataType,
  upsertMetadataValue,
} from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { postMetadataSchema } from '../schemas/postMetadata.schema';

export const main = withLambdaHandler(async (req) => {
  const input = postMetadataSchema.parse(req);

  if (input.entityType === 'type') {
    const body = input.body;
    // applicableModules is optional on metadata type create (persisted as [] when omitted).
    return upsertMetadataType(
      normalizeMetadataTypeInput(body as MetadataTypeInput & Record<string, unknown>),
      input.userId,
    );
  }

  const raw = input.body as MetadataValueInput & Record<string, unknown>;
  const metadataTypeCode = String(raw.metadataTypeCode).trim();
  const valueCode = (raw.valueCode ?? raw.metadataValueCode) as string;
  const existing = await getValue(metadataTypeCode, valueCode);
  const normalized = normalizeMetadataValueInput(
    { ...raw, valueCode, metadataValueCode: valueCode } as MetadataValueInput & Record<string, unknown>,
    existing,
  );
  const record = await upsertMetadataValue(metadataTypeCode, normalized, input.userId, existing);
  return flattenMetadataValueForApi(record);
});
