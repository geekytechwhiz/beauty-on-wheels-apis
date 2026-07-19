import { LambdaRequest } from "@api-hub/utils";

import {
    CapabilitiesService,
    getCapabilitiesService
} from "../services/capabilities.service";

export class CapabilitiesController {

    constructor(

        private readonly service: CapabilitiesService =
            getCapabilitiesService()

    ) {}



    async handleGetvendorcapabilities(
        request: LambdaRequest
    ) {

        return this.service.getvendorcapabilities(
            request
        );

    }



    async handleUpdatevendorcapabilities(
        request: LambdaRequest
    ) {

        return this.service.updatevendorcapabilities(
            request
        );

    }

}

let controller: CapabilitiesController;

export function getCapabilitiesController() {

    if (!controller) {

        controller =
            new CapabilitiesController();

    }

    return controller;

}
