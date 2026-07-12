import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getCustomersController
} from "../controllers/customers.controller";

import {
    validateCustomerProfile
} from "../schemas/customers.schema";

const controller =
    getCustomersController();

export const handleGetuserid =
    withApiHandler(
        {
            operation: "getuserid",
        },
        async (request: LambdaRequest) =>
            controller.handleGetuserid(request)
    );

export const handlePutuserid =
    withApiHandler(
        {
            operation: "putuserid",
            validator: (request: LambdaRequest) => { validateCustomerProfile(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePutuserid(request)
    );
