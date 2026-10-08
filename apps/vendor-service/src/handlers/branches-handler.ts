import { withVendorApiHandler } from "./with-vendor-handler";
import { LambdaRequest } from '@api-hub/utils';

import { getBranchesController } from '../controllers/branches.controller';
import {
  validateCreateBranchRequest,
  validateUpdateBranchRequest,
} from '../schemas/branches.schema';

const controller = getBranchesController();

export const handleListvendorbranches = withVendorApiHandler(
  { operation: 'listvendorbranches' },
  async (request: LambdaRequest) => controller.handleListvendorbranches(request),
);

export const handleCreatevendorbranch = withVendorApiHandler(
  {
    operation: 'createvendorbranch',
    validator: (request: LambdaRequest) => {
      validateCreateBranchRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleCreatevendorbranch(request),
);

export const handleGetvendorbranch = withVendorApiHandler(
  { operation: 'getvendorbranch' },
  async (request: LambdaRequest) => controller.handleGetvendorbranch(request),
);

export const handleUpdatevendorbranch = withVendorApiHandler(
  {
    operation: 'updatevendorbranch',
    validator: (request: LambdaRequest) => {
      validateUpdateBranchRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleUpdatevendorbranch(request),
);

export const handleDeletevendorbranch = withVendorApiHandler(
  { operation: 'deletevendorbranch' },
  async (request: LambdaRequest) => controller.handleDeletevendorbranch(request),
);
