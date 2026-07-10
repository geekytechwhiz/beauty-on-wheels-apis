import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    AuthenticationRepository,
    getAuthenticationRepository
} from "../repositories/authentication.repository";

const baseLogger = createLogger({
    service: "authentication-service",
    redactPII: true,
});

export class AuthenticationService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "AuthenticationService"
            }
        );

    constructor(

        private readonly repository: AuthenticationRepository =
            getAuthenticationRepository()

    ) {
        this.repository;
    }



    async postlogin(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postlogin",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postrefreshtoken(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postrefreshtoken",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postlogout(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postlogout",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postchangepassword(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postchangepassword",
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

let service: AuthenticationService;

export function getAuthenticationService() {

    if (!service) {

        service =
            new AuthenticationService();

    }

    return service;

}
