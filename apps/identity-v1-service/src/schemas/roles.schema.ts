import { z } from 'zod';
import { BaseError, LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

export const AdminRoleAssignmentSchema = z
  .object({
    role: z.literal('ADMIN'),
  })
  .strict();

export type AdminRoleAssignment = z.infer<typeof AdminRoleAssignmentSchema>;

export function validateAdminRoleAssignment(
  request: LambdaRequest,
): AdminRoleAssignment {
  const result = AdminRoleAssignmentSchema.safeParse(request.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  const userId = request.params?.userId?.trim();
  if (!userId) {
    throw new BaseError('userId is required', 400, 'VALIDATION_ERROR');
  }
  return result.data;
}

export function validateAdminRoleRevocation(request: LambdaRequest): {
  userId: string;
  role: string;
} {
  const userId = request.params?.userId?.trim();
  const role = request.params?.role?.trim();
  if (!userId || !role) {
    throw new BaseError('userId and role are required', 400, 'VALIDATION_ERROR');
  }
  return { userId, role };
}
