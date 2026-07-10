import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    ProfileRepository,
    getProfileRepository
} from "../repositories/profile.repository";

const baseLogger = createLogger({
    service: "profile-service",
    redactPII: true,
});

export class ProfileService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "ProfileService"
            }
        );

    constructor(

        private readonly repository: ProfileRepository =
            getProfileRepository()

    ) {
        this.repository;
    }



    async getme(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getme",
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

let service: ProfileService;

export function getProfileService() {

    if (!service) {

        service =
            new ProfileService();

    }

    return service;

}
