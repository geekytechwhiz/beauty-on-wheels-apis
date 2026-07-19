import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getAvailabilityController
} from "../controllers/availability.controller";

import {
    validateWorkingHours
} from "../schemas/availability.schema";

const controller =
    getAvailabilityController();

export const handleGetworkinghours =
    withApiHandler(
        {
            operation: "getworkinghours",
        },
        async (request: LambdaRequest) =>
            controller.handleGetworkinghours(request)
    );

export const handlePutworkinghours =
    withApiHandler(
        {
            operation: "putworkinghours",
            validator: (request: LambdaRequest) => { validateWorkingHours(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePutworkinghours(request)
    );
