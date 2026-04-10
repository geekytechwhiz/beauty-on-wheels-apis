import { withLambdaHandler, type LambdaRequest } from '@api-hub/utils';
import {
  updateMetadataValueSchema,
  MetadataValidationError,
} from '@api-hub/metadata';
import { getService } from '../utils/service-factory';

const validate = (req: LambdaRequest) => {
  if (!req.pathParameters?.metadataTypeCode) {
    throw new MetadataValidationError('metadataTypeCode path parameter is required');
  }
  if (!req.pathParameters?.metadataValueCode) {
    throw new MetadataValidationError('metadataValueCode path parameter is required');
  }
  const result = updateMetadataValueSchema.safeParse(req.body);
  if (!result.success) {
    throw new MetadataValidationError(
      'Validation failed',
      result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    );
  }
  (req as any).validatedBody = result.data;
};

const handler = async (req: LambdaRequest) => {
  const { metadataTypeCode, metadataValueCode } = req.pathParameters!;
  const input = (req as any).validatedBody;
  input.lastModifiedBy = req.context.userContext?.userId;
  return getService().updateMetadataValue(metadataTypeCode, metadataValueCode, input);
};

export const main = withLambdaHandler(handler, { validator: validate });
