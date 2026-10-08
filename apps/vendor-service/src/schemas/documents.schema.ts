import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

import { env } from '../configs/env.config';
import { DOCUMENT_TYPE } from '../domain/onboarding';

const documentTypeSchema = z.enum([
  DOCUMENT_TYPE.GST_REGISTRATION,
  DOCUMENT_TYPE.BUSINESS_REGISTRATION,
  DOCUMENT_TYPE.COMMERCIAL_INSURANCE,
]);

const contentTypeSchema = z.enum(
  env.DOCUMENT_ALLOWED_CONTENT_TYPES as [string, ...string[]],
);

const fileNameSchema = z.string().min(1).max(255);
const fileSizeSchema = z
  .number()
  .int()
  .positive()
  .max(env.DOCUMENT_MAX_FILE_SIZE);

export const CreateDocumentRequestSchema = z
  .object({
    documentType: documentTypeSchema,
    fileName: fileNameSchema,
    contentType: contentTypeSchema,
    fileSize: fileSizeSchema,
  })
  .strict();

export const UpdateDocumentRequestSchema = z
  .object({
    fileName: fileNameSchema.optional(),
    contentType: contentTypeSchema.optional(),
    fileSize: fileSizeSchema.optional(),
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
