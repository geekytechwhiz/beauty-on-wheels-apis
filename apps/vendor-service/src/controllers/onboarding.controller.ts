import { LambdaRequest } from '@api-hub/utils';

import {
  OnboardingService,
  getOnboardingService,
} from '../services/onboarding.service';

export class OnboardingController {
  constructor(
    private readonly service: OnboardingService = getOnboardingService(),
  ) {}

  async handleGetvendoronboarding(request: LambdaRequest) {
    return this.service.getvendoronboarding(request);
  }

  async handleUpdatevendoronboarding(request: LambdaRequest) {
    return this.service.updatevendoronboarding(request);
  }

  async handleSubmitvendorforreview(request: LambdaRequest) {
    return this.service.submitvendorforreview(request);
  }
}

let controller: OnboardingController;

export function getOnboardingController() {
  if (!controller) {
    controller = new OnboardingController();
  }
  return controller;
}
