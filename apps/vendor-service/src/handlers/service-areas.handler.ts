import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getServiceAreasController
} from "../controllers/service-areas.controller";

import {
    validateCreateServiceAreaRequest,
    validateUpdateServiceAreaRequest
} from "../schemas/service-areas.schema";

const controller =
    getServiceAreasController();

export const handleListvendorserviceareas =
    withApiHandler(
        {
            operation: "listvendorserviceareas",
        },
        async (request: LambdaRequest) =>
            controller.handleListvendorserviceareas(request)
    );

export const handleAddvendorservicearea =
    withApiHandler(
        {
            operation: "addvendorservicearea",
            validator: (request: LambdaRequest) => { validateCreateServiceAreaRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleAddvendorservicearea(request)
    );

export const handleGetvendorservicearea =
    withApiHandler(
        {
            operation: "getvendorservicearea",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvendorservicearea(request)
    );

export const handleUpdatevendorservicearea =
    withApiHandler(
        {
            operation: "updatevendorservicearea",
            validator: (request: LambdaRequest) => { validateUpdateServiceAreaRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendorservicearea(request)
    );

export const handleDeletevendorservicearea =
    withApiHandler(
        {
            operation: "deletevendorservicearea",
        },
        async (request: LambdaRequest) =>
            controller.handleDeletevendorservicearea(request)
    );
