import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    PermissionsRepository,
    getPermissionsRepository
} from "../repositories/permissions.repository";

const baseLogger = createLogger({
    service: "permissions-service",
    redactPII: true,
});

export class PermissionsService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "PermissionsService"
            }
        );

    constructor(

        private readonly repository: PermissionsRepository =
            getPermissionsRepository()

    ) {
        this.repository;
    }



    async getpermissions(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getpermissions",
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

let service: PermissionsService;

export function getPermissionsService() {

    if (!service) {

        service =
            new PermissionsService();

    }

    return service;

}
