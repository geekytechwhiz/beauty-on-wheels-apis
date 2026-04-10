import { withLambdaHandler, type LambdaRequest } from '@api-hub/utils';
import {
  listMetadataTypesQuerySchema,
  MetadataValidationError,
} from '@api-hub/metadata';
import { getService } from '../utils/service-factory';

const validate = (req: LambdaRequest) => {
  const result = listMetadataTypesQuerySchema.safeParse(req.params);
  if (!result.success) {
    throw new MetadataValidationError(
      'Invalid query parameters',
      result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    );
  }
  (req as any).validatedQuery = result.data;
};

const handler = async (req: LambdaRequest) => {
  const query = (req as any).validatedQuery;
  const result = await getService().listMetadataTypesPaginated({
    limit: query.limit,
    nextToken: query.nextToken,
    includeInactive: query.includeInactive,
  });
  return {
    items: result.items,
    nextToken: result.nextToken,
  };
};

export const main = withLambdaHandler(handler, { validator: validate });
