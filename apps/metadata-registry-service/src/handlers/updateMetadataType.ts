import { withLambdaHandler, type LambdaRequest } from '@api-hub/utils';
import {
  updateMetadataTypeSchema,
  MetadataValidationError,
} from '@api-hub/metadata';
import { getService } from '../utils/service-factory';

const validate = (req: LambdaRequest) => {
  if (!req.pathParameters?.metadataTypeCode) {
    throw new MetadataValidationError('metadataTypeCode path parameter is required');
  }
  const result = updateMetadataTypeSchema.safeParse(req.body);
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
  const metadataTypeCode = req.pathParameters!.metadataTypeCode;
  const input = (req as any).validatedBody;
  input.updatedBy = req.context.userContext?.userId;
  return getService().updateMetadataType(metadataTypeCode, input);
};

export const main = withLambdaHandler(handler, { validator: validate });
