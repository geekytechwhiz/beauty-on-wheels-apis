import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    AvailabilityRepository,
    getAvailabilityRepository
} from "../repositories/availability.repository";

const baseLogger = createLogger({
    service: "availability-service",
    redactPII: true,
});

export class AvailabilityService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "AvailabilityService"
            }
        );

    constructor(

        private readonly repository: AvailabilityRepository =
            getAvailabilityRepository()

    ) {
        this.repository;
    }



    async getworkinghours(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getworkinghours",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async putworkinghours(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "putworkinghours",
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

let service: AvailabilityService;

export function getAvailabilityService() {

    if (!service) {

        service =
            new AvailabilityService();

    }

    return service;

}
