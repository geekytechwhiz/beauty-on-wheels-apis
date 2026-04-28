import { NotFoundError, STATUS, ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { flattenMetadataValueForApi, getType, getValue, parseGetEntityStatusMode } from '../services/metadataService';

type GetMetadataRequest = {
  params?: Record<string, string>;
  pathParameters?: Record<string, string>;
};

function resolveEntityType(req: GetMetadataRequest): string {
  return (req.params?.entityType ?? req.pathParameters?.entityType ?? '').trim();
}

function typeCodeFromRequest(req: GetMetadataRequest): string {
  const q = req.params ?? {};
  return (q.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '').trim();
}

function valuePathFromRequest(req: GetMetadataRequest): { metadataTypeCode: string; valueCode: string } {
  const q = req.params ?? {};
  return {
    metadataTypeCode: (q.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '').trim(),
    valueCode: (
      q.metadataValueCode ??
      q.valueCode ??
      req.pathParameters?.metadataValueCode ??
      ''
    ).trim(),
  };
}

export const main = withLambdaHandler(async (req: GetMetadataRequest) => {
  const entityType = resolveEntityType(req);
  if (!entityType) {
    throw new ValidationError('entityType is required in path', [{ field: 'entityType', message: 'Required' }]);
  }
  const kind = entityType.toLowerCase();
  const q = req.params ?? {};

  if (kind === 'type') {
    const code = typeCodeFromRequest(req);
    if (!code) {
      throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
    }
    const mode = parseGetEntityStatusMode(q);
    const t = await getType(code);
    if (!t) {
      throw new NotFoundError(`Metadata type ${code} not found`);
    }
    if (mode === 'all') {
      return t;
    }
    if (mode === 'inactive') {
      if (t.status !== STATUS.INACTIVE) {
        throw new NotFoundError(`Metadata type ${code} not found`);
      }
      return t;
    }
    if (t.status !== STATUS.ACTIVE) {
      throw new NotFoundError(`Metadata type ${code} not found`);
    }
    return t;
  }

  if (kind === 'value') {
    const { metadataTypeCode, valueCode } = valuePathFromRequest(req);
    if (!metadataTypeCode) {
      throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
    }
    if (!valueCode) {
      throw new ValidationError('metadataValueCode is required', [{ field: 'metadataValueCode', message: 'Required' }]);
    }
    const mode = parseGetEntityStatusMode(q);
    const v = await getValue(metadataTypeCode, valueCode);
    if (!v) {
      throw new NotFoundError(`Value ${valueCode} not found`);
    }
    if (mode === 'all') {
      return flattenMetadataValueForApi(v);
    }
    if (mode === 'inactive') {
      if (v.status !== STATUS.INACTIVE) {
        throw new NotFoundError(`Value ${valueCode} not found`);
      }
      return flattenMetadataValueForApi(v);
    }
    if (v.status !== STATUS.ACTIVE) {
      throw new NotFoundError(`Value ${valueCode} not found`);
    }
    return flattenMetadataValueForApi(v);
  }

  throw new ValidationError('entityType must be "type" or "value"', [
    { field: 'entityType', message: 'Must be "type" or "value"' },
  ]);
}, { useCreated: false });
