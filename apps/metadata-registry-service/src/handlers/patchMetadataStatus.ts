import { ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import {
  flattenMetadataValueForApi,
  parsePatchStatusBody,
  patchTypeStatus,
  patchValueStatus,
} from '../services/metadataService';

type PatchMetadataStatusRequest = {
  params?: Record<string, string>;
  pathParameters?: Record<string, string>;
  body?: Record<string, unknown>;
  context?: { userContext?: { userId?: string } };
};

export const main = withLambdaHandler(
  async (req: PatchMetadataStatusRequest) => {
    const rawEntity = req.params?.entityType || req.pathParameters?.entityType;
    const entityType = (rawEntity ?? '').trim();
    if (!entityType) {
      throw new ValidationError('entityType is required in path', [{ field: 'entityType', message: 'Required' }]);
    }
    const kind = entityType.toLowerCase();
    const userId = req.context?.userContext?.userId;
    const body = req.body;

    if (kind === 'type') {
      const code = body?.metadataTypeCode;
      if (code === undefined || code === null || String(code).trim() === '') {
        throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
      }
      const status = parsePatchStatusBody(body?.status);
      return patchTypeStatus(String(code).trim(), status, userId);
    }
    if (kind === 'value') {
      const metadataTypeCode = body?.metadataTypeCode;
      if (metadataTypeCode === undefined || metadataTypeCode === null || String(metadataTypeCode).trim() === '') {
        throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
      }
      const valueCode = (body?.valueCode ?? body?.metadataValueCode) as string | undefined;
      if (valueCode === undefined || valueCode === null || String(valueCode).trim() === '') {
        throw new ValidationError('metadataTypeCode and metadataValueCode are required', [
          { field: 'metadataValueCode', message: 'valueCode or metadataValueCode is required' },
        ]);
      }
      const status = parsePatchStatusBody(body?.status);
      const record = await patchValueStatus(
        String(metadataTypeCode).trim(),
        String(valueCode).trim(),
        status,
        userId,
      );
      return flattenMetadataValueForApi(record);
    }
    throw new ValidationError('entityType must be "type" or "value"', [
      { field: 'entityType', message: 'Must be "type" or "value"' },
    ]);
  },
  { useCreated: false },
);
