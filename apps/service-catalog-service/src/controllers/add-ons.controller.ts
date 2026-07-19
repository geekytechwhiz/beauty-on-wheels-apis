import { LambdaRequest } from "@api-hub/utils";

import {
    AddOnsService,
    getAddOnsService
} from "../services/add-ons.service";

export class AddOnsController {

    constructor(

        private readonly service: AddOnsService =
            getAddOnsService()

    ) {}



    async handleGetaddons(
        request: LambdaRequest
    ) {

        return this.service.getaddons(
            request
        );

    }



    async handlePostaddons(
        request: LambdaRequest
    ) {

        return this.service.postaddons(
            request
        );

    }



    async handleGetaddonid(
        request: LambdaRequest
    ) {

        return this.service.getaddonid(
            request
        );

    }



    async handlePutaddonid(
        request: LambdaRequest
    ) {

        return this.service.putaddonid(
            request
        );

    }



    async handleDeleteaddonid(
        request: LambdaRequest
    ) {

        return this.service.deleteaddonid(
            request
        );

    }

}

let controller: AddOnsController;

export function getAddOnsController() {

    if (!controller) {

        controller =
            new AddOnsController();

    }

    return controller;

}
