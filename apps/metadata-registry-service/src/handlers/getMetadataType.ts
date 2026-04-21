import { NotFoundError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { getType } from '../services/metadataService';

export const main = withLambdaHandler(
  async (req: { params?: Record<string, string>; pathParameters?: { metadataTypeCode?: string } }) => {
    const code = req.params?.metadataTypeCode ?? req.pathParameters?.metadataTypeCode;
    if (!code) {
      throw new NotFoundError('metadataTypeCode is required');
    }
    const t = await getType(code);
    if (!t) {
      throw new NotFoundError(`Metadata type ${code} not found`);
    }
    return t;
  },
  { useCreated: false },
);
