import { ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import type { MetadataValueInput } from '@api-hub/metadata';
import {
  flattenMetadataValueForApi,
  normalizeMetadataValueInput,
  upsertMetadataValue,
} from '../services/metadataService';

function codeFromReq(req: { params?: Record<string, string>; pathParameters?: Record<string, string> }): string {
  return req.params?.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '';
}

export const main = withLambdaHandler(
  async (req: {
    params?: Record<string, string>;
    pathParameters?: Record<string, string>;
    body?: MetadataValueInput;
    context?: { userContext?: { userId?: string } };
  }) => {
    const metadataTypeCode = codeFromReq(req);
    if (!metadataTypeCode) {
      throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
    }
    const body = normalizeMetadataValueInput((req.body ?? {}) as MetadataValueInput & Record<string, unknown>);
    if (!body.valueCode) {
      throw new ValidationError('valueCode or metadataValueCode is required', [
        { field: 'valueCode', message: 'Required' },
      ]);
    }
    const record = await upsertMetadataValue(metadataTypeCode, body, req.context?.userContext?.userId);
    return flattenMetadataValueForApi(record);
  },
  { useCreated: false },
);
