import { LambdaRequest } from "@api-hub/utils";

import {
    AvailabilityService,
    getAvailabilityService
} from "../services/availability.service";

export class AvailabilityController {

    constructor(

        private readonly service: AvailabilityService =
            getAvailabilityService()

    ) {}



    async handleGetworkinghours(
        request: LambdaRequest
    ) {

        return this.service.getworkinghours(
            request
        );

    }



    async handlePutworkinghours(
        request: LambdaRequest
    ) {

        return this.service.putworkinghours(
            request
        );

    }

    async handleGetavailability(
        request: LambdaRequest
    ) {
        return this.service.getavailability(request);
    }

}

let controller: AvailabilityController;

export function getAvailabilityController() {

    if (!controller) {

        controller =
            new AvailabilityController();

    }

    return controller;

}
