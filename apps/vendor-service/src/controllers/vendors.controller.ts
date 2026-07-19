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



    async handleCreatevendor(
        request: LambdaRequest
    ) {

        return this.service.createvendor(
            request
        );

    }



    async handleListvendors(
        request: LambdaRequest
    ) {

        return this.service.listvendors(
            request
        );

    }



    async handleGetvendor(
        request: LambdaRequest
    ) {

        return this.service.getvendor(
            request
        );

    }



    async handleUpdatevendor(
        request: LambdaRequest
    ) {

        return this.service.updatevendor(
            request
        );

    }



    async handleUpdatevendorstatus(
        request: LambdaRequest
    ) {

        return this.service.updatevendorstatus(
            request
        );

    }



    async handleUpdatevendoroperationalstatus(
        request: LambdaRequest
    ) {

        return this.service.updatevendoroperationalstatus(
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
