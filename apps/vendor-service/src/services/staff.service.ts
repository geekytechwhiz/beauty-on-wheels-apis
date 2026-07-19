import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    StaffRepository,
    getStaffRepository
} from "../repositories/staff.repository";

const baseLogger = createLogger({
    service: "staff-service",
    redactPII: true,
});

export class StaffService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "StaffService"
            }
        );

    constructor(

        private readonly repository: StaffRepository =
            getStaffRepository()

    ) {
        this.repository;
    }



    async listvendorstaff(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "listvendorstaff",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async createvendorstaff(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "createvendorstaff",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async getvendorstaff(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getvendorstaff",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async updatevendorstaff(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "updatevendorstaff",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async deactivatevendorstaff(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "deactivatevendorstaff",
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

let service: StaffService;

export function getStaffService() {

    if (!service) {

        service =
            new StaffService();

    }

    return service;

}
