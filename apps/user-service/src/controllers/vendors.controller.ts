import { LambdaRequest } from "@api-hub/utils";

import {
    VendorsService,
    getVendorsService
} from "../services/vendors.service";

export class VendorsController {

    constructor(

        private readonly service: VendorsService =
            getVendorsService()

    ) {}



    async handleGetuserid(
        request: LambdaRequest
    ) {

        return this.service.getuserid(
            request
        );

    }



    async handlePutuserid(
        request: LambdaRequest
    ) {

        return this.service.putuserid(
            request
        );

    }

}

let controller: VendorsController;

export function getVendorsController() {

    if (!controller) {

        controller =
            new VendorsController();

    }

    return controller;

}
