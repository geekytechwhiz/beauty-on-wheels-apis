import { LambdaRequest } from '@api-hub/utils';

import { AddressesService, getAddressesService } from '../services/addresses.service';

export class AddressesController {
  constructor(
    private readonly service: AddressesService = getAddressesService(),
  ) {}

  async listAddresses(request: LambdaRequest) {
    return this.service.listAddresses(request);
  }

  async getAddress(request: LambdaRequest) {
    return this.service.getAddress(request);
  }

  async createAddress(request: LambdaRequest) {
    return this.service.createAddress(request);
  }

  async updateAddress(request: LambdaRequest) {
    return this.service.updateAddress(request);
  }

  async deleteAddress(request: LambdaRequest) {
    return this.service.deleteAddress(request);
  }
}

let controller: AddressesController;

export function getAddressesController(): AddressesController {
  if (!controller) {
    controller = new AddressesController();
  }
  return controller;
}
