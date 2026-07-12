import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    PreferencesRepository,
    getPreferencesRepository
} from "../repositories/preferences.repository";

const baseLogger = createLogger({
    service: "preferences-service",
    redactPII: true,
});

export class PreferencesService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "PreferencesService"
            }
        );

    constructor(

        private readonly repository: PreferencesRepository =
            getPreferencesRepository()

    ) {
        this.repository;
    }



    async getpreferences(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getpreferences",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async putpreferences(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "putpreferences",
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

let service: PreferencesService;

export function getPreferencesService() {

    if (!service) {

        service =
            new PreferencesService();

    }

    return service;

}
