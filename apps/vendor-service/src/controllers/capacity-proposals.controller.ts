import { LambdaRequest } from '@api-hub/utils';

import {
  CapacityProposalsService,
  getCapacityProposalsService,
} from '../services/capacity-proposals.service';

export class CapacityProposalsController {
  constructor(
    private readonly service: CapacityProposalsService = getCapacityProposalsService(),
  ) {}

  async handleCreatecapacityproposal(request: LambdaRequest) {
    return this.service.createcapacityproposal(request);
  }

  async handleSendcapacityproposal(request: LambdaRequest) {
    return this.service.sendcapacityproposal(request);
  }

  async handleAcceptcapacitycounter(request: LambdaRequest) {
    return this.service.acceptcapacitycounter(request);
  }

  async handleRevisecapacityproposal(request: LambdaRequest) {
    return this.service.revisecapacityproposal(request);
  }

  async handleDeclinecapacityproposal(request: LambdaRequest) {
    return this.service.declinecapacityproposal(request);
  }

  async handleListcapacityproposals(request: LambdaRequest) {
    return this.service.listcapacityproposals(request);
  }

  async handleGetcapacityproposal(request: LambdaRequest) {
    return this.service.getcapacityproposal(request);
  }

  async handleListvendorcapacitycommitments(request: LambdaRequest) {
    return this.service.listvendorcapacitycommitments(request);
  }

  async handleOpslistcapacitycommitments(request: LambdaRequest) {
    return this.service.opslistcapacitycommitments(request);
  }

  async handleGetcapacitycommitment(request: LambdaRequest) {
    return this.service.getcapacitycommitment(request);
  }

  async handleListvendorcapacityproposals(request: LambdaRequest) {
    return this.service.listvendorcapacityproposals(request);
  }

  async handleGetvendorcapacityproposal(request: LambdaRequest) {
    return this.service.getvendorcapacityproposal(request);
  }

  async handleAcceptvendorcapacityproposal(request: LambdaRequest) {
    return this.service.acceptvendorcapacityproposal(request);
  }

  async handleCountervendorcapacityproposal(request: LambdaRequest) {
    return this.service.countervendorcapacityproposal(request);
  }

  async handleDeclinevendorcapacityproposal(request: LambdaRequest) {
    return this.service.declinevendorcapacityproposal(request);
  }
}

let controller: CapacityProposalsController;

export function getCapacityProposalsController() {
  if (!controller) {
    controller = new CapacityProposalsController();
  }
  return controller;
}
