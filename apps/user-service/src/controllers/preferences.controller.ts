import { LambdaRequest } from '@api-hub/utils';

import {
  getPreferencesService,
  PreferencesService,
} from '../services/preferences.service';

export class PreferencesController {
  constructor(
    private readonly service: PreferencesService = getPreferencesService(),
  ) {}

  async getPreferences(request: LambdaRequest) {
    return this.service.getPreferences(request);
  }

  async putPreferences(request: LambdaRequest) {
    return this.service.putPreferences(request);
  }
}

let controller: PreferencesController;

export function getPreferencesController(): PreferencesController {
  if (!controller) {
    controller = new PreferencesController();
  }
  return controller;
}
