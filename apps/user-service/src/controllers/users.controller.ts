import { LambdaRequest, ValidationError } from '@api-hub/utils';

import { UsersService, getUsersService } from '../services/users.service';

export class UsersController {
  constructor(private readonly service: UsersService = getUsersService()) {}

  async lookupByPhone(request: LambdaRequest) {
    return this.service.lookupByPhone(request);
  }

  async getUser(request: LambdaRequest) {
    return this.service.getUser(request);
  }

  async getUserByCognitoSub(request: LambdaRequest) {
    const cognitoSub = readCognitoSub(request);
    if (!cognitoSub) {
      throw new ValidationError('cognitoSub is required');
    }
    return this.service.getUserByCognitoSub(cognitoSub);
  }
}

function readCognitoSub(request: LambdaRequest): string {
  const pathValue = request.pathParameters?.cognitoSub;
  const paramValue = request.params?.cognitoSub;
  const value = typeof pathValue === 'string' ? pathValue : paramValue;
  return typeof value === 'string' ? value.trim() : '';
}

let controller: UsersController;

export function getUsersController(): UsersController {
  if (!controller) {
    controller = new UsersController();
  }
  return controller;
}
