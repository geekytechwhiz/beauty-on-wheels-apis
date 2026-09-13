import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

export const CreateDocumentRequestSchema = z
  .object({
    documentType: z.enum([
      'GST_REGISTRATION',
      'BUSINESS_REGISTRATION',
      'COMMERCIAL_INSURANCE',
    ]),
    fileName: z.string().min(1).max(255),
    contentType: z.string().min(1).max(100),
  })
  .strict();

export const UpdateDocumentRequestSchema = z
  .object({
    fileName: z.string().min(1).max(255).optional(),
    contentType: z.string().min(1).max(100).optional(),
  })
  .strict();

export const validateCreateDocumentRequest = (req: LambdaRequest) => {
  const result = CreateDocumentRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  return result.data;
};

export const validateUpdateDocumentRequest = (req: LambdaRequest) => {
  const result = UpdateDocumentRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  return result.data;
};
