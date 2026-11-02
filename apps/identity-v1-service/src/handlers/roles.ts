import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getRolesController } from '../controllers/roles.controller';
import {
  validateAdminRoleAssignment,
  validateAdminRoleRevocation,
} from '../schemas/roles.schema';

const controller = getRolesController();

export const handleGetroles = withApiHandler(
  {
    operation: 'getroles',
    validator: () => undefined,
  },
  async (request: LambdaRequest) => controller.handleGetroles(request),
);

export const handleAssignAdminRole = withApiHandler(
  {
    operation: 'assignAdminRole',
    validator: (request: LambdaRequest) => {
      validateAdminRoleAssignment(request);
    },
  },
  async (request: LambdaRequest) => controller.handleAssignAdminRole(request),
);

export const handleRevokeAdminRole = withApiHandler(
  {
    operation: 'revokeAdminRole',
    validator: (request: LambdaRequest) => {
      validateAdminRoleRevocation(request);
    },
  },
  async (request: LambdaRequest) => controller.handleRevokeAdminRole(request),
);
