import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    SlotsRepository,
    getSlotsRepository
} from "../repositories/slots.repository";

const baseLogger = createLogger({
    service: "slots-service",
    redactPII: true,
});

export class SlotsService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "SlotsService"
            }
        );

    constructor(

        private readonly repository: SlotsRepository =
            getSlotsRepository()

    ) {
        this.repository;
    }



    async getslots(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getslots",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postslots(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postslots",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async getslotid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getslotid",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postblock(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postblock",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postunblock(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postunblock",
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

let service: SlotsService;

export function getSlotsService() {

    if (!service) {

        service =
            new SlotsService();

    }

    return service;

}
