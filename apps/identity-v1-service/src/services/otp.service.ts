import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    OtpRepository,
    getOtpRepository
} from "../repositories/otp.repository";

const baseLogger = createLogger({
    service: "otp-service",
    redactPII: true,
});

export class OtpService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "OtpService"
            }
        );

    constructor(

        private readonly repository: OtpRepository =
            getOtpRepository()

    ) {
        this.repository;
    }



    async postsend(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postsend",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postverify(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postverify",
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

let service: OtpService;

export function getOtpService() {

    if (!service) {

        service =
            new OtpService();

    }

    return service;

}
