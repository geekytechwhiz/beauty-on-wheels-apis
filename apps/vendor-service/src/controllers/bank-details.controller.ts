import { LambdaRequest } from '@api-hub/utils';

import {
  BankDetailsService,
  getBankDetailsService,
} from '../services/bank-details.service';

export class BankDetailsController {
  constructor(
    private readonly service: BankDetailsService = getBankDetailsService(),
  ) {}

  async handleGetvendorbankdetails(request: LambdaRequest) {
    return this.service.getvendorbankdetails(request);
  }

  async handleUpdatevendorbankdetails(request: LambdaRequest) {
    return this.service.updatevendorbankdetails(request);
  }
}

let controller: BankDetailsController;

export function getBankDetailsController() {
  if (!controller) {
    controller = new BankDetailsController();
  }
  return controller;
}
