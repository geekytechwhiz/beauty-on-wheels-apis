import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    RegistrationRepository,
    getRegistrationRepository
} from "../repositories/registration.repository";

const baseLogger = createLogger({
    service: "registration-service",
    redactPII: true,
});

export class RegistrationService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "RegistrationService"
            }
        );

    constructor(

        private readonly repository: RegistrationRepository =
            getRegistrationRepository()

    ) {
        this.repository;
    }



    async postregister(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postregister",
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

let service: RegistrationService;

export function getRegistrationService() {

    if (!service) {

        service =
            new RegistrationService();

    }

    return service;

}
