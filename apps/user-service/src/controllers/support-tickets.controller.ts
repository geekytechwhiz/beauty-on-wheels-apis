import { LambdaRequest } from '@api-hub/utils';

import {
  getSupportTicketsService,
  SupportTicketsService,
} from '../services/support-tickets.service';

export class SupportTicketsController {
  constructor(
    private readonly service: SupportTicketsService = getSupportTicketsService(),
  ) {}

  async create(request: LambdaRequest) {
    return this.service.create(request);
  }

  async list(request: LambdaRequest) {
    return this.service.list(request);
  }

  async get(request: LambdaRequest) {
    return this.service.get(request);
  }
}

let controller: SupportTicketsController;

export function getSupportTicketsController(): SupportTicketsController {
  if (!controller) {
    controller = new SupportTicketsController();
  }
  return controller;
}
