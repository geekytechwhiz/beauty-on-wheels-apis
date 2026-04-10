import { withLambdaHandler, type LambdaRequest } from '@api-hub/utils';
import {
  createMetadataTypeSchema,
  MetadataValidationError,
} from '@api-hub/metadata';
import { getService } from '../utils/service-factory';

const validate = (req: LambdaRequest) => {
  const result = createMetadataTypeSchema.safeParse(req.body);
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
  const input = (req as any).validatedBody;
  input.createdBy = req.context.userContext?.userId;
  return getService().createMetadataType(input);
};

export const main = withLambdaHandler(handler, {
  validator: validate,
  useCreated: true,
});
