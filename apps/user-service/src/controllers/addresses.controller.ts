import { LambdaRequest } from "@api-hub/utils";

import {
    AddressesService,
    getAddressesService
} from "../services/addresses.service";

export class AddressesController {

    constructor(

        private readonly service: AddressesService =
            getAddressesService()

    ) {}



    async handleGetaddresses(
        request: LambdaRequest
    ) {

        return this.service.getaddresses(
            request
        );

    }



    async handlePostaddresses(
        request: LambdaRequest
    ) {

        return this.service.postaddresses(
            request
        );

    }



    async handlePutaddressid(
        request: LambdaRequest
    ) {

        return this.service.putaddressid(
            request
        );

    }



    async handleDeleteaddressid(
        request: LambdaRequest
    ) {

        return this.service.deleteaddressid(
            request
        );

    }

}

let controller: AddressesController;

export function getAddressesController() {

    if (!controller) {

        controller =
            new AddressesController();

    }

    return controller;

}
