import { LambdaRequest } from "@api-hub/utils";

import {
    CustomersService,
    getCustomersService
} from "../services/customers.service";

export class CustomersController {

    constructor(

        private readonly service: CustomersService =
            getCustomersService()

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

let controller: CustomersController;

export function getCustomersController() {

    if (!controller) {

        controller =
            new CustomersController();

    }

    return controller;

}
