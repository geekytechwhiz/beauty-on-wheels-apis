import { NotFoundError, STATUS } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { getType, parseGetEntityStatusMode } from '../services/metadataService';

export const main = withLambdaHandler(
  async (req: { params?: Record<string, string>; pathParameters?: { metadataTypeCode?: string } }) => {
    const q = req.params ?? {};
    const code = q.metadataTypeCode ?? req.pathParameters?.metadataTypeCode;
    if (!code) {
      throw new NotFoundError('metadataTypeCode is required');
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
  },
  { useCreated: false },
);
