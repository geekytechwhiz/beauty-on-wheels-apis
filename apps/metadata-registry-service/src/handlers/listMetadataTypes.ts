import { STATUS } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { listTypes } from '../services/metadataService';

export const main = withLambdaHandler(
  async (req: { params?: Record<string, string | undefined> }) => {
    const q = req.params ?? {};
    const status = q.status === STATUS.ACTIVE || q.status === STATUS.INACTIVE ? q.status : undefined;
    return listTypes({
      status,
      module: q.module,
      valueDataType: q.valueDataType ?? q.datatype,
    });
  },
  { useCreated: false },
);
