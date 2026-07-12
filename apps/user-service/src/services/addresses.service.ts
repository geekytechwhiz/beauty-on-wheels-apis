import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    AddressesRepository,
    getAddressesRepository
} from "../repositories/addresses.repository";

const baseLogger = createLogger({
    service: "addresses-service",
    redactPII: true,
});

export class AddressesService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "AddressesService"
            }
        );

    constructor(

        private readonly repository: AddressesRepository =
            getAddressesRepository()

    ) {
        this.repository;
    }



    async getaddresses(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getaddresses",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postaddresses(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postaddresses",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async putaddressid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "putaddressid",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async deleteaddressid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "deleteaddressid",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }

}

let service: AddressesService;

export function getAddressesService() {

    if (!service) {

        service =
            new AddressesService();

    }

    return service;

}
