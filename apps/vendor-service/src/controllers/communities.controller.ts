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

  async handleUpdatecommunitycoverageapproval(request: LambdaRequest) {
    return this.service.updatecommunitycoverageapproval(request);
  }

  async handleRemovevendorcommunity(request: LambdaRequest) {
    return this.service.removevendorcommunity(request);
  }
  async handleListcommunities(request: LambdaRequest) {
    return this.service.listcommunities(request);
  }

  handleListPartnerCommunityDirectory(request: LambdaRequest) {
    return this.service.listPartnerCommunityDirectory(request);
  }

  handleGetPartnerCommunityCoverage(request: LambdaRequest) {
    return this.service.getPartnerCommunityCoverage(request);
  }

  handleReplacePartnerCommunityCoverage(request: LambdaRequest) {
    return this.service.replacePartnerCommunityCoverage(request);
  }
}

let controller: CommunitiesController;

export function getCommunitiesController() {
  if (!controller) {
    controller = new CommunitiesController();
  }
  return controller;
}
