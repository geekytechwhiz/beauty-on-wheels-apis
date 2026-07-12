import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    UsersRepository,
    getUsersRepository
} from "../repositories/users.repository";

const baseLogger = createLogger({
    service: "users-service",
    redactPII: true,
});

export class UsersService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "UsersService"
            }
        );

    constructor(

        private readonly repository: UsersRepository =
            getUsersRepository()

    ) {
        this.repository;
    }



    async getusers(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getusers",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postusers(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postusers",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

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



    async deleteuserid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "deleteuserid",
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

let service: UsersService;

export function getUsersService() {

    if (!service) {

        service =
            new UsersService();

    }

    return service;

}
