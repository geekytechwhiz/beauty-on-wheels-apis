import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    RolesRepository,
    getRolesRepository
} from "../repositories/roles.repository";

const baseLogger = createLogger({
    service: "roles-service",
    redactPII: true,
});

export class RolesService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "RolesService"
            }
        );

    constructor(

        private readonly repository: RolesRepository =
            getRolesRepository()

    ) {
        this.repository;
    }



    async getroles(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getroles",
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

let service: RolesService;

export function getRolesService() {

    if (!service) {

        service =
            new RolesService();

    }

    return service;

}
