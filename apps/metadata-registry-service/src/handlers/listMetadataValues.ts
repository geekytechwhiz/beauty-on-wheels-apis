import { STATUS, ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { flattenMetadataValueForApi, listValues, parseListEntityStatusMode } from '../services/metadataService';

export const main = withLambdaHandler(
  async (req: { params?: Record<string, string>; pathParameters?: Record<string, string> }) => {
    const q = req.params ?? {};
    const metadataTypeCode = q.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '';
    if (!metadataTypeCode) {
      throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
    }
    /** Default: ACTIVE values only. `include-inactive=true` lists all for admin/history. `status=INACTIVE` lists inactive only. */
    const mode = parseListEntityStatusMode(q);
    const statusOrAll = mode === 'all' ? null : mode === 'inactive' ? STATUS.INACTIVE : STATUS.ACTIVE;
    const rows = await listValues(metadataTypeCode, statusOrAll);
    return rows.map(flattenMetadataValueForApi);
  },
  { useCreated: false },
);
