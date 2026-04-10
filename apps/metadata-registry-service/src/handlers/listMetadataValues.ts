import { withLambdaHandler, type LambdaRequest } from '@api-hub/utils';
import {
  listMetadataValuesQuerySchema,
  MetadataValidationError,
} from '@api-hub/metadata';
import { getService } from '../utils/service-factory';

const validate = (req: LambdaRequest) => {
  if (!req.pathParameters?.metadataTypeCode) {
    throw new MetadataValidationError('metadataTypeCode path parameter is required');
  }
  const result = listMetadataValuesQuerySchema.safeParse(req.params);
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
  const metadataTypeCode = req.pathParameters!.metadataTypeCode;
  const query = (req as any).validatedQuery;

  const result = await getService().listMetadataValuesPaginated(
    metadataTypeCode,
    {
      limit: query.limit,
      nextToken: query.nextToken,
      includeInactive: query.includeInactive,
    },
  );

  return {
    items: result.items,
    nextToken: result.nextToken,
  };
};

export const main = withLambdaHandler(handler, { validator: validate });
