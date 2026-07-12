import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    KycRepository,
    getKycRepository
} from "../repositories/kyc.repository";

const baseLogger = createLogger({
    service: "kyc-service",
    redactPII: true,
});

export class KycService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "KycService"
            }
        );

    constructor(

        private readonly repository: KycRepository =
            getKycRepository()

    ) {
        this.repository;
    }



    async postkyc(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postkyc",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async getkyc(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getkyc",
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

let service: KycService;

export function getKycService() {

    if (!service) {

        service =
            new KycService();

    }

    return service;

}
