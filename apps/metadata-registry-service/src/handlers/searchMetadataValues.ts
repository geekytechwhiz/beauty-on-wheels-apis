import { ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import type { ValueSearchFilter } from '@api-hub/metadata';
import { searchValues } from '../services/filterService';
import { flattenMetadataValueForApi } from '../services/metadataService';

export const main = withLambdaHandler(
  async (req: {
    params?: Record<string, string>;
    pathParameters?: Record<string, string>;
    body?: ValueSearchFilter;
  }) => {
    const metadataTypeCode = req.params?.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '';
    if (!metadataTypeCode) {
      throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
    }
    const filter: ValueSearchFilter = req.body ?? {};
    const rows = await searchValues(metadataTypeCode, filter);
    return rows.map(flattenMetadataValueForApi);
  },
  { useCreated: false },
);
