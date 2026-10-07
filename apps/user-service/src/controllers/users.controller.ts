import { LambdaRequest } from '@api-hub/utils';

import { UsersService, getUsersService } from '../services/users.service';

export class UsersController {
  constructor(private readonly service: UsersService = getUsersService()) {}

  async lookupByPhone(request: LambdaRequest) {
    return this.service.lookupByPhone(request);
  }

  async getUser(request: LambdaRequest) {
    return this.service.getUser(request);
  }
}

let controller: UsersController;

export function getUsersController(): UsersController {
  if (!controller) {
    controller = new UsersController();
  }
  return controller;
}
