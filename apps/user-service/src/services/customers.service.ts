import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    CustomersRepository,
    getCustomersRepository
} from "../repositories/customers.repository";

const baseLogger = createLogger({
    service: "customers-service",
    redactPII: true,
});

export class CustomersService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "CustomersService"
            }
        );

    constructor(

        private readonly repository: CustomersRepository =
            getCustomersRepository()

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

let service: CustomersService;

export function getCustomersService() {

    if (!service) {

        service =
            new CustomersService();

    }

    return service;

}
