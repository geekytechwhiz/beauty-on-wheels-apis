import { STATUS, ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { flattenMetadataValueForApi, listTypes, listValues, parseListEntityStatusMode } from '../services/metadataService';

type ListMetadataRequest = {
  params?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined>;
};

function resolveEntityType(req: ListMetadataRequest): string {
  return String(req.params?.entityType ?? req.pathParameters?.entityType ?? '').trim();
}

/**
 * `listTypes` / `listValues` only support the filter shapes exposed on the service layer.
 * Type list: status (via `parseListEntityStatusMode` + `include-inactive`), `module`, `valueDataType` / `datatype`.
 * Value list: `metadataTypeCode` in query, same status mode; additional dimensions are not in the list API.
 */
export const main = withLambdaHandler(async (req: ListMetadataRequest) => {
  const entityType = resolveEntityType(req);
  if (!entityType) {
    throw new ValidationError('entityType is required in path', [{ field: 'entityType', message: 'Required' }]);
  }
  const kind = entityType.toLowerCase();
  const q = req.params ?? {};

  if (kind === 'type') {
    const mode = parseListEntityStatusMode(q);
    const base = {
      module: q.module,
      valueDataType: q.valueDataType ?? q.datatype,
    };
    if (mode === 'all') {
      return listTypes(base);
    }
    return listTypes({
      ...base,
      status: mode === 'inactive' ? STATUS.INACTIVE : STATUS.ACTIVE,
    });
  }

  if (kind === 'value') {
    const metadataTypeCode = String(
      q.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '',
    ).trim();
    if (!metadataTypeCode) {
      throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
    }
    const mode = parseListEntityStatusMode(q);
    const statusOrAll = mode === 'all' ? null : mode === 'inactive' ? STATUS.INACTIVE : STATUS.ACTIVE;
    const rows = await listValues(metadataTypeCode, statusOrAll);
    return rows.map(flattenMetadataValueForApi);
  }

  throw new ValidationError('entityType must be "type" or "value"', [
    { field: 'entityType', message: 'Must be "type" or "value"' },
  ]);
}, { useCreated: false });
