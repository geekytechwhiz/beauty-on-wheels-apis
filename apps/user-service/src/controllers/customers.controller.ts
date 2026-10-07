import { LambdaRequest } from '@api-hub/utils';

import { CustomersService, getCustomersService } from '../services/customers.service';

export class CustomersController {
  constructor(
    private readonly service: CustomersService = getCustomersService(),
  ) {}

  async getCustomer(request: LambdaRequest) {
    return this.service.getCustomer(request);
  }

  async putCustomer(request: LambdaRequest) {
    return this.service.putCustomer(request);
  }
}

let controller: CustomersController;

export function getCustomersController(): CustomersController {
  if (!controller) {
    controller = new CustomersController();
  }
  return controller;
}
