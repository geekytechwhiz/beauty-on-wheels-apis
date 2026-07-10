import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    SessionsRepository,
    getSessionsRepository
} from "../repositories/sessions.repository";

const baseLogger = createLogger({
    service: "sessions-service",
    redactPII: true,
});

export class SessionsService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "SessionsService"
            }
        );

    constructor(

        private readonly repository: SessionsRepository =
            getSessionsRepository()

    ) {
        this.repository;
    }



    async getsessions(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getsessions",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async deletesessions(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "deletesessions",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async deletesessionid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "deletesessionid",
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

let service: SessionsService;

export function getSessionsService() {

    if (!service) {

        service =
            new SessionsService();

    }

    return service;

}
