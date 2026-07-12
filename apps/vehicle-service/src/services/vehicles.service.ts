import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    VehiclesRepository,
    getVehiclesRepository
} from "../repositories/vehicles.repository";

const baseLogger = createLogger({
    service: "vehicles-service",
    redactPII: true,
});

export class VehiclesService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "VehiclesService"
            }
        );

    constructor(

        private readonly repository: VehiclesRepository =
            getVehiclesRepository()

    ) {
        this.repository;
    }



    async getvehicles(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getvehicles",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postvehicles(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postvehicles",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async getvehicleid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getvehicleid",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async putvehicleid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "putvehicleid",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async deletevehicleid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "deletevehicleid",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async putdefault(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "putdefault",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async getvehicletypes(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getvehicletypes",
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

let service: VehiclesService;

export function getVehiclesService() {

    if (!service) {

        service =
            new VehiclesService();

    }

    return service;

}
