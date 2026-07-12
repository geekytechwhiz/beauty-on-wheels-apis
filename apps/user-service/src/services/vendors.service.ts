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



    async getuserid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getuserid",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async putuserid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "putuserid",
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
