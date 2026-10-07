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

    async handleListavailablecapabilities(
        request: LambdaRequest
    ) {
        return this.service.listavailablecapabilities(request);
    }



    async handleUpdatevendorcapabilities(
        request: LambdaRequest
    ) {

        return this.service.updatevendorcapabilities(
            request
        );

    }

    async handleGetvendorservices(request: LambdaRequest) {
        return this.service.getvendorservices(request);
    }

    async handleUpdatevendorservices(request: LambdaRequest) {
        return this.service.updatevendorservices(request);
    }

    async handleGetvendorpackages(request: LambdaRequest) {
        return this.service.getvendorpackages(request);
    }

    async handleUpdatevendorpackages(request: LambdaRequest) {
        return this.service.updatevendorpackages(request);
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
