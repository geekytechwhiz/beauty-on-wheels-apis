import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getAddOnsController
} from "../controllers/add-ons.controller";

import {
    validateAddOn,
    validateAddOnUpdate,
} from "../schemas/add-ons.schema";

const controller =
    getAddOnsController();

export const handleGetaddons =
    withApiHandler(
        {
            operation: "getaddons",
        },
        async (request: LambdaRequest) =>
            controller.handleGetaddons(request)
    );

export const handlePostaddons =
    withApiHandler(
        {
            operation: "postaddons",
            validator: (request: LambdaRequest) => { validateAddOn(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostaddons(request)
    );

export const handleGetaddonid =
    withApiHandler(
        {
            operation: "getaddonid",
        },
        async (request: LambdaRequest) =>
            controller.handleGetaddonid(request)
    );

export const handlePutaddonid =
    withApiHandler(
        {
            operation: "putaddonid",
            validator: (request: LambdaRequest) => { validateAddOnUpdate(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePutaddonid(request)
    );

export const handleDeleteaddonid =
    withApiHandler(
        {
            operation: "deleteaddonid",
        },
        async (request: LambdaRequest) =>
            controller.handleDeleteaddonid(request)
    );
