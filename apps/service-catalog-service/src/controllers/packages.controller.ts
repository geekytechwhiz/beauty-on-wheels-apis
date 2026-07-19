import { LambdaRequest } from "@api-hub/utils";

import {
    PackagesService,
    getPackagesService
} from "../services/packages.service";

export class PackagesController {

    constructor(

        private readonly service: PackagesService =
            getPackagesService()

    ) {}



    async handleGetpackages(
        request: LambdaRequest
    ) {

        return this.service.getpackages(
            request
        );

    }



    async handlePostpackages(
        request: LambdaRequest
    ) {

        return this.service.postpackages(
            request
        );

    }



    async handleGetpackageid(
        request: LambdaRequest
    ) {

        return this.service.getpackageid(
            request
        );

    }



    async handlePutpackageid(
        request: LambdaRequest
    ) {

        return this.service.putpackageid(
            request
        );

    }



    async handleDeletepackageid(
        request: LambdaRequest
    ) {

        return this.service.deletepackageid(
            request
        );

    }

}

let controller: PackagesController;

export function getPackagesController() {

    if (!controller) {

        controller =
            new PackagesController();

    }

    return controller;

}
