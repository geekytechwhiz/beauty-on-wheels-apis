import { LambdaRequest } from "@api-hub/utils";

import {
    SlotsService,
    getSlotsService
} from "../services/slots.service";

export class SlotsController {

    constructor(

        private readonly service: SlotsService =
            getSlotsService()

    ) {}



    async handleGetslots(
        request: LambdaRequest
    ) {

        return this.service.getslots(
            request
        );

    }



    async handlePostslots(
        request: LambdaRequest
    ) {

        return this.service.postslots(
            request
        );

    }



    async handleGetslotid(
        request: LambdaRequest
    ) {

        return this.service.getslotid(
            request
        );

    }



    async handlePostblock(
        request: LambdaRequest
    ) {

        return this.service.postblock(
            request
        );

    }



    async handlePostunblock(
        request: LambdaRequest
    ) {

        return this.service.postunblock(
            request
        );

    }

}

let controller: SlotsController;

export function getSlotsController() {

    if (!controller) {

        controller =
            new SlotsController();

    }

    return controller;

}
