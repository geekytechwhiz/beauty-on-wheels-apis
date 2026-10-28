import { LambdaRequest } from '@api-hub/utils';

import { ServicesService, getServicesService } from '../services/services.service';
import { DiscoveryPage } from '../types/api-types';

/**
 * Internal discovery helper used by tests and legacy projection tooling.
 * Public HTTP discovery is `GET /offerings`.
 */
export class ServicesController {
  constructor(
    private readonly service: ServicesService = getServicesService(),
  ) {}

  async handleDiscoverServices(request: LambdaRequest): Promise<DiscoveryPage> {
    return this.service.discoverServices({
      ...(request.query ?? {}),
      ...(request.params ?? {}),
    });
  }
}

let controller: ServicesController | undefined;

export function getServicesController(): ServicesController {
  if (!controller) {
    controller = new ServicesController();
  }
  return controller;
}
