import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    CapabilitiesRepository,
    getCapabilitiesRepository
} from "../repositories/capabilities.repository";

const baseLogger = createLogger({
    service: "capabilities-service",
    redactPII: true,
});

export class CapabilitiesService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "CapabilitiesService"
            }
        );

    constructor(

        private readonly repository: CapabilitiesRepository =
            getCapabilitiesRepository()

    ) {
        this.repository;
    }



    async getvendorcapabilities(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getvendorcapabilities",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async updatevendorcapabilities(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "updatevendorcapabilities",
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

let service: CapabilitiesService;

export function getCapabilitiesService() {

    if (!service) {

        service =
            new CapabilitiesService();

    }

    return service;

}
