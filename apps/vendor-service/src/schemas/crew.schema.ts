import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

const staffId = z.string().trim().min(1);

export const CreateCrewRequestSchema = z.object({
  name: z.string().trim().min(2).max(100),
  vanLabel: z.string().trim().min(1).max(80),
  staffIds: z.array(staffId).min(2).max(20),
}).strict();

export const UpdateCrewRequestSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  vanLabel: z.string().trim().min(1).max(80).optional(),
  staffIds: z.array(staffId).min(2).max(20).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  revision: z.number().int().nonnegative().optional(),
}).strict();

function parse<T>(schema: z.ZodType<T>, req: LambdaRequest): T {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  return result.data;
}

export const validateCreateCrewRequest = (req: LambdaRequest) =>
  parse(CreateCrewRequestSchema, req);

export const validateUpdateCrewRequest = (req: LambdaRequest) =>
  parse(UpdateCrewRequestSchema, req);
