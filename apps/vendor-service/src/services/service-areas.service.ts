import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    ServiceAreasRepository,
    getServiceAreasRepository
} from "../repositories/service-areas.repository";

const baseLogger = createLogger({
    service: "service-areas-service",
    redactPII: true,
});

export class ServiceAreasService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "ServiceAreasService"
            }
        );

    constructor(

        private readonly repository: ServiceAreasRepository =
            getServiceAreasRepository()

    ) {
        this.repository;
    }



    async listvendorserviceareas(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "listvendorserviceareas",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async addvendorservicearea(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "addvendorservicearea",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async getvendorservicearea(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getvendorservicearea",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async updatevendorservicearea(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "updatevendorservicearea",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async deletevendorservicearea(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "deletevendorservicearea",
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

let service: ServiceAreasService;

export function getServiceAreasService() {

    if (!service) {

        service =
            new ServiceAreasService();

    }

    return service;

}
