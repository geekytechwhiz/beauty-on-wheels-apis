import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getRolesController } from '../controllers/roles.controller';
import { requireAuth } from '../auth/require-auth';
import {
  validateAdminRoleAssignment,
  validateAdminRoleRevocation,
} from '../schemas/roles.schema';

const controller = getRolesController();

export const handleGetroles = withApiHandler(
  {
    operation: 'getroles',
    validator: async (request: LambdaRequest) => {
      await requireAuth(request);
    },
  },
  async (request: LambdaRequest) => controller.handleGetroles(request),
);

export const handleAssignAdminRole = withApiHandler(
  {
    operation: 'assignAdminRole',
    validator: async (request: LambdaRequest) => {
      await requireAuth(request);
      validateAdminRoleAssignment(request);
    },
  },
  async (request: LambdaRequest) => controller.handleAssignAdminRole(request),
);

export const handleRevokeAdminRole = withApiHandler(
  {
    operation: 'revokeAdminRole',
    validator: async (request: LambdaRequest) => {
      await requireAuth(request);
      validateAdminRoleRevocation(request);
    },
  },
  async (request: LambdaRequest) => controller.handleRevokeAdminRole(request),
);
