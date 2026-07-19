import { LambdaRequest } from "@api-hub/utils";

import {
    ServiceAreasService,
    getServiceAreasService
} from "../services/service-areas.service";

export class ServiceAreasController {

    constructor(

        private readonly service: ServiceAreasService =
            getServiceAreasService()

    ) {}



    async handleListvendorserviceareas(
        request: LambdaRequest
    ) {

        return this.service.listvendorserviceareas(
            request
        );

    }



    async handleAddvendorservicearea(
        request: LambdaRequest
    ) {

        return this.service.addvendorservicearea(
            request
        );

    }



    async handleGetvendorservicearea(
        request: LambdaRequest
    ) {

        return this.service.getvendorservicearea(
            request
        );

    }



    async handleUpdatevendorservicearea(
        request: LambdaRequest
    ) {

        return this.service.updatevendorservicearea(
            request
        );

    }



    async handleDeletevendorservicearea(
        request: LambdaRequest
    ) {

        return this.service.deletevendorservicearea(
            request
        );

    }

}

let controller: ServiceAreasController;

export function getServiceAreasController() {

    if (!controller) {

        controller =
            new ServiceAreasController();

    }

    return controller;

}
