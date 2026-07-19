import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    OperatingHoursRepository,
    getOperatingHoursRepository
} from "../repositories/operating-hours.repository";

const baseLogger = createLogger({
    service: "operating-hours-service",
    redactPII: true,
});

export class OperatingHoursService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "OperatingHoursService"
            }
        );

    constructor(

        private readonly repository: OperatingHoursRepository =
            getOperatingHoursRepository()

    ) {
        this.repository;
    }



    async getvendoroperatinghours(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getvendoroperatinghours",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async updatevendoroperatinghours(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "updatevendoroperatinghours",
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

let service: OperatingHoursService;

export function getOperatingHoursService() {

    if (!service) {

        service =
            new OperatingHoursService();

    }

    return service;

}
