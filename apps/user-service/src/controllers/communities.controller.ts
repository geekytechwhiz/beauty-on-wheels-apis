import { LambdaRequest } from '@api-hub/utils';

import {
  CommunitiesService,
  getCommunitiesService,
} from '../services/communities.service';

export class CommunitiesController {
  constructor(
    private readonly service: CommunitiesService = getCommunitiesService(),
  ) {}

  async createCommunity(request: LambdaRequest) {
    return this.service.createCommunity(request);
  }

  async listCommunities(request: LambdaRequest) {
    return this.service.listCommunities(request);
  }

  async getCommunity(request: LambdaRequest) {
    return this.service.getCommunity(request);
  }

  async updateCommunity(request: LambdaRequest) {
    return this.service.updateCommunity(request);
  }

  async deleteCommunity(request: LambdaRequest) {
    return this.service.deleteCommunity(request);
  }

  async getMembership(request: LambdaRequest) {
    return this.service.getMembership(request);
  }

  async putMembership(request: LambdaRequest) {
    return this.service.putMembership(request);
  }
}

let controller: CommunitiesController;

export function getCommunitiesController(): CommunitiesController {
  if (!controller) {
    controller = new CommunitiesController();
  }
  return controller;
}
