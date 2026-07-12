import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getAddressesController
} from "../controllers/addresses.controller";

import {
    validateAddress,
    validateAddress
} from "../schemas/addresses.schema";

const controller =
    getAddressesController();

export const handleGetaddresses =
    withApiHandler(
        {
            operation: "getaddresses",
        },
        async (request: LambdaRequest) =>
            controller.handleGetaddresses(request)
    );

export const handlePostaddresses =
    withApiHandler(
        {
            operation: "postaddresses",
            validator: (request: LambdaRequest) => { validateAddress(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostaddresses(request)
    );

export const handlePutaddressid =
    withApiHandler(
        {
            operation: "putaddressid",
            validator: (request: LambdaRequest) => { validateAddress(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePutaddressid(request)
    );

export const handleDeleteaddressid =
    withApiHandler(
        {
            operation: "deleteaddressid",
        },
        async (request: LambdaRequest) =>
            controller.handleDeleteaddressid(request)
    );
