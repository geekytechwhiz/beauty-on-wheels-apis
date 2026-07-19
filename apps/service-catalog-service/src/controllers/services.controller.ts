import { LambdaRequest } from "@api-hub/utils";

import {
    ServicesService,
    getServicesService
} from "../services/services.service";

export class ServicesController {

    constructor(

        private readonly service: ServicesService =
            getServicesService()

    ) {}



    async handleGetservices(
        request: LambdaRequest
    ) {

        return this.service.getservices(
            request
        );

    }



    async handlePostservices(
        request: LambdaRequest
    ) {

        return this.service.postservices(
            request
        );

    }



    async handleGetserviceid(
        request: LambdaRequest
    ) {

        return this.service.getserviceid(
            request
        );

    }



    async handlePutserviceid(
        request: LambdaRequest
    ) {

        return this.service.putserviceid(
            request
        );

    }



    async handleDeleteserviceid(
        request: LambdaRequest
    ) {

        return this.service.deleteserviceid(
            request
        );

    }

}

let controller: ServicesController;

export function getServicesController() {

    if (!controller) {

        controller =
            new ServicesController();

    }

    return controller;

}
