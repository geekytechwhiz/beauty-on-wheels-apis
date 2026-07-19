import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    HolidaysRepository,
    getHolidaysRepository
} from "../repositories/holidays.repository";

const baseLogger = createLogger({
    service: "holidays-service",
    redactPII: true,
});

export class HolidaysService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "HolidaysService"
            }
        );

    constructor(

        private readonly repository: HolidaysRepository =
            getHolidaysRepository()

    ) {
        this.repository;
    }



    async getholidays(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getholidays",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postholidays(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postholidays",
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

let service: HolidaysService;

export function getHolidaysService() {

    if (!service) {

        service =
            new HolidaysService();

    }

    return service;

}
