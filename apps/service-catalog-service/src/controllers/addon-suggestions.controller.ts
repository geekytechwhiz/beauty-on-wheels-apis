import { LambdaRequest } from '@api-hub/utils';

import {
  AddonSuggestionsService,
  getAddonSuggestionsService,
} from '../services/addon-suggestions.service';

export class AddonSuggestionsController {
  constructor(
    private readonly suggestions: AddonSuggestionsService = getAddonSuggestionsService(),
  ) {}

  submit(request: LambdaRequest) {
    return this.suggestions.submit(request);
  }

  listForVendor(request: LambdaRequest) {
    return this.suggestions.listForVendor(request);
  }

  getForVendor(request: LambdaRequest) {
    return this.suggestions.getForVendor(request);
  }

  opsList(request: LambdaRequest) {
    return this.suggestions.opsList(request);
  }

  review(request: LambdaRequest) {
    return this.suggestions.review(request);
  }
}

let controller: AddonSuggestionsController | undefined;

export function getAddonSuggestionsController(): AddonSuggestionsController {
  if (!controller) {
    controller = new AddonSuggestionsController();
  }
  return controller;
}
