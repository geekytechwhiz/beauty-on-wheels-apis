import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getServicesController
} from "../controllers/services.controller";

import {
    validateService,
    validateServiceUpdate,
} from "../schemas/services.schema";

const controller =
    getServicesController();

export const handleGetservices =
    withApiHandler(
        {
            operation: "getservices",
        },
        async (request: LambdaRequest) =>
            controller.handleGetservices(request)
    );

export const handlePostservices =
    withApiHandler(
        {
            operation: "postservices",
            validator: (request: LambdaRequest) => { validateService(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostservices(request)
    );

export const handleGetserviceid =
    withApiHandler(
        {
            operation: "getserviceid",
        },
        async (request: LambdaRequest) =>
            controller.handleGetserviceid(request)
    );

export const handlePutserviceid =
    withApiHandler(
        {
            operation: "putserviceid",
            validator: (request: LambdaRequest) => { validateServiceUpdate(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePutserviceid(request)
    );

export const handleDeleteserviceid =
    withApiHandler(
        {
            operation: "deleteserviceid",
        },
        async (request: LambdaRequest) =>
            controller.handleDeleteserviceid(request)
    );
