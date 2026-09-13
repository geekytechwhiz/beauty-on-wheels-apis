import { LambdaRequest } from '@api-hub/utils';

import {
  BranchesService,
  getBranchesService,
} from '../services/branches.service';

export class BranchesController {
  constructor(
    private readonly service: BranchesService = getBranchesService(),
  ) {}

  async handleListvendorbranches(request: LambdaRequest) {
    return this.service.listvendorbranches(request);
  }

  async handleCreatevendorbranch(request: LambdaRequest) {
    return this.service.createvendorbranch(request);
  }

  async handleGetvendorbranch(request: LambdaRequest) {
    return this.service.getvendorbranch(request);
  }

  async handleUpdatevendorbranch(request: LambdaRequest) {
    return this.service.updatevendorbranch(request);
  }

  async handleDeletevendorbranch(request: LambdaRequest) {
    return this.service.deletevendorbranch(request);
  }
}

let controller: BranchesController;

export function getBranchesController() {
  if (!controller) {
    controller = new BranchesController();
  }
  return controller;
}
