import { LambdaRequest } from '@api-hub/utils';

import {
  CommunitiesService,
  getCommunitiesService,
} from '../services/communities.service';

export class CommunitiesController {
  constructor(
    private readonly service: CommunitiesService = getCommunitiesService(),
  ) {}

  async handleListvendorcommunities(request: LambdaRequest) {
    return this.service.listvendorcommunities(request);
  }

  async handleReplacevendorcommunities(request: LambdaRequest) {
    return this.service.replacevendorcommunities(request);
  }

  async handleAddvendorcommunity(request: LambdaRequest) {
    return this.service.addvendorcommunity(request);
  }

  async handleRemovevendorcommunity(request: LambdaRequest) {
    return this.service.removevendorcommunity(request);
  }
}

let controller: CommunitiesController;

export function getCommunitiesController() {
  if (!controller) {
    controller = new CommunitiesController();
  }
  return controller;
}
