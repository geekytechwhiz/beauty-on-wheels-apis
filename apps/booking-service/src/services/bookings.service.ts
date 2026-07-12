import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    BookingsRepository,
    getBookingsRepository
} from "../repositories/bookings.repository";

const baseLogger = createLogger({
    service: "bookings-service",
    redactPII: true,
});

export class BookingsService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "BookingsService"
            }
        );

    constructor(

        private readonly repository: BookingsRepository =
            getBookingsRepository()

    ) {
        this.repository;
    }



    async getbookings(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getbookings",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postbookings(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postbookings",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async getbookingid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getbookingid",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async putbookingid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "putbookingid",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async deletebookingid(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "deletebookingid",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postconfirm(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postconfirm",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postcheckin(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postcheckin",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async poststart(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "poststart",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postcomplete(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postcomplete",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async postcancel(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "postcancel",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async getbookings(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getbookings",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }



    async getbookings(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "getbookings",
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

let service: BookingsService;

export function getBookingsService() {

    if (!service) {

        service =
            new BookingsService();

    }

    return service;

}
