import { STATUS } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { listTypes, parseListEntityStatusMode } from '../services/metadataService';

export const main = withLambdaHandler(
  async (req: { params?: Record<string, string | undefined> }) => {
    const q = req.params ?? {};
    /** Default: ACTIVE types only. `include-inactive=true` (or `includeInactive`) lists all for admin/history. `status=INACTIVE` lists inactive only. */
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
  },
  { useCreated: false },
);
