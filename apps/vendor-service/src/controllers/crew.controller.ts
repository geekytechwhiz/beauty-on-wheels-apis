import { LambdaRequest } from '@api-hub/utils';

import { CrewService, getCrewService } from '../services/crew.service';

export class CrewController {
  constructor(private readonly service: CrewService = getCrewService()) {}

  handleListvendorcrews(request: LambdaRequest) {
    return this.service.listvendorcrews(request);
  }

  handleCreatevendorcrew(request: LambdaRequest) {
    return this.service.createvendorcrew(request);
  }

  handleGetvendorcrew(request: LambdaRequest) {
    return this.service.getvendorcrew(request);
  }

  handleUpdatevendorcrew(request: LambdaRequest) {
    return this.service.updatevendorcrew(request);
  }

  handleDeactivatevendorcrew(request: LambdaRequest) {
    return this.service.deactivatevendorcrew(request);
  }
}

let controller: CrewController;

export function getCrewController() {
  if (!controller) {
    controller = new CrewController();
  }
  return controller;
}
