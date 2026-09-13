import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getBranchesController } from '../controllers/branches.controller';
import {
  validateCreateBranchRequest,
  validateUpdateBranchRequest,
} from '../schemas/branches.schema';

const controller = getBranchesController();

export const handleListvendorbranches = withApiHandler(
  { operation: 'listvendorbranches' },
  async (request: LambdaRequest) => controller.handleListvendorbranches(request),
);

export const handleCreatevendorbranch = withApiHandler(
  {
    operation: 'createvendorbranch',
    validator: (request: LambdaRequest) => {
      validateCreateBranchRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleCreatevendorbranch(request),
);

export const handleGetvendorbranch = withApiHandler(
  { operation: 'getvendorbranch' },
  async (request: LambdaRequest) => controller.handleGetvendorbranch(request),
);

export const handleUpdatevendorbranch = withApiHandler(
  {
    operation: 'updatevendorbranch',
    validator: (request: LambdaRequest) => {
      validateUpdateBranchRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleUpdatevendorbranch(request),
);

export const handleDeletevendorbranch = withApiHandler(
  { operation: 'deletevendorbranch' },
  async (request: LambdaRequest) => controller.handleDeletevendorbranch(request),
);
