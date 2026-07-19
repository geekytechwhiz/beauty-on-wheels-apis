import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    VendorsRepository,
    getVendorsRepository
} from "../repositories/vendors.repository";

const baseLogger = createLogger({
    service: "vendors-service",
    redactPII: true,
});

export class VendorsService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "VendorsService"
            }
        );

    constructor(

        private readonly repository: VendorsRepository =
            getVendorsRepository()

    ) {
        this.repository;
    }



    async createvendor(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "createvendor",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async listvendors(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "listvendors",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async getvendor(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getvendor",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async updatevendor(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "updatevendor",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async updatevendorstatus(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "updatevendorstatus",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async updatevendoroperationalstatus(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "updatevendoroperationalstatus",
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

let service: VendorsService;

export function getVendorsService() {

    if (!service) {

        service =
            new VendorsService();

    }

    return service;

}
