import { withApiHandler } from '@api-hub/middleware';
import { BaseError, LambdaRequest } from '@api-hub/utils';
import { getUploadUrlSchema, GetUploadUrlInput } from '../dto/schemas.js';
import { getRecipientRepository, getStorageProvider } from '../../../common/providers/container.js';
import { RecipientService } from '../services/RecipientService.js';

const recipientService = new RecipientService(getRecipientRepository(), getStorageProvider());

type ValidatedRequest = LambdaRequest & { validatedQuery: GetUploadUrlInput };

const validateGetUploadUrlRequest = (req: LambdaRequest): void => {
  const result = getUploadUrlSchema.safeParse(req.event.queryStringParameters ?? {});

  if (!result.success) {
    throw new BaseError(
      result.error.issues[0]?.message ?? 'Validation failed',
      400,
      'VALIDATION_ERROR',
      result.error.issues.map((i) => ({
        field: i.path.join('.') || undefined,
        message: i.message,
      })),
      { retryable: false },
    );
  }

  (req as ValidatedRequest).validatedQuery = result.data;
};

const handler = async (req: LambdaRequest) => {
  const { filename } = (req as ValidatedRequest).validatedQuery;
  const result = await recipientService.generateUploadUrl(filename);

  return {
    uploadUrl: result.uploadUrl,
    filename: result.filename,
  };
};

export const main = withApiHandler({
  operation: 'recipient.getUploadUrl',
  validator: validateGetUploadUrlRequest,
}, handler);

export default main;
