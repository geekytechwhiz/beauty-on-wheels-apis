import { ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { listTypeAudit, listValueAudit } from '@api-hub/metadata';

type ListMetadataAuditRequest = {
  params?: Record<string, string>;
  pathParameters?: Record<string, string>;
};

function metadataTypeCodeFrom(req: ListMetadataAuditRequest): string {
  const q = req.params ?? {};
  return (q.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '').trim();
}

function valueCodeFrom(req: ListMetadataAuditRequest): string {
  const q = req.params ?? {};
  return (
    q.metadataValueCode ?? q.valueCode ?? req.pathParameters?.metadataValueCode ?? ''
  ).trim();
}

export const main = withLambdaHandler(
  async (req: ListMetadataAuditRequest) => {
    const rawEntity = req.params?.entityType || req.pathParameters?.entityType;
    const entityType = (rawEntity ?? '').trim();
    if (!entityType) {
      throw new ValidationError('entityType is required in path', [{ field: 'entityType', message: 'Required' }]);
    }
    const kind = entityType.toLowerCase();

    if (kind === 'type') {
      const metadataTypeCode = metadataTypeCodeFrom(req);
      if (!metadataTypeCode) {
        throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
      }
      return listTypeAudit(metadataTypeCode);
    }
    if (kind === 'value') {
      const metadataTypeCode = metadataTypeCodeFrom(req);
      if (!metadataTypeCode) {
        throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
      }
      const valueCode = valueCodeFrom(req);
      if (!valueCode) {
        throw new ValidationError('metadataTypeCode and metadataValueCode are required', [
          { field: 'metadataValueCode', message: 'valueCode or metadataValueCode is required' },
        ]);
      }
      return listValueAudit(metadataTypeCode, valueCode);
    }
    throw new ValidationError('entityType must be "type" or "value"', [
      { field: 'entityType', message: 'Must be "type" or "value"' },
    ]);
  },
  { useCreated: false },
);
