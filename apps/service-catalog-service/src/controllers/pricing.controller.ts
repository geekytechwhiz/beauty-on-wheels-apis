import { LambdaRequest } from "@api-hub/utils";

import { getPricingService, PricingService } from "../services/pricing.service";

export class PricingController {
  constructor(
    private readonly service: PricingService = getPricingService(),
  ) {}

  handlePostpricingcalculate(request: LambdaRequest) {
    return this.service.calculate(request);
  }
}

let controller: PricingController | undefined;

export function getPricingController(): PricingController {
  if (!controller) {
    controller = new PricingController();
  }
  return controller;
}
