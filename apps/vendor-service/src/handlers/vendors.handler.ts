import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getVendorsController
} from "../controllers/vendors.controller";

import {
    validateCreateVendorRequest,
    validateUpdateVendorRequest,
    validateUpdateVendorStatusRequest,
    validateUpdateOperationalStatusRequest
} from "../schemas/vendors.schema";

const controller =
    getVendorsController();

export const handleCreatevendor =
    withApiHandler(
        {
            operation: "createvendor",
            validator: (request: LambdaRequest) => { validateCreateVendorRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleCreatevendor(request)
    );

export const handleListvendors =
    withApiHandler(
        {
            operation: "listvendors",
        },
        async (request: LambdaRequest) =>
            controller.handleListvendors(request)
    );

export const handleGetvendor =
    withApiHandler(
        {
            operation: "getvendor",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvendor(request)
    );

export const handleUpdatevendor =
    withApiHandler(
        {
            operation: "updatevendor",
            validator: (request: LambdaRequest) => { validateUpdateVendorRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendor(request)
    );

export const handleUpdatevendorstatus =
    withApiHandler(
        {
            operation: "updatevendorstatus",
            validator: (request: LambdaRequest) => { validateUpdateVendorStatusRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendorstatus(request)
    );

export const handleUpdatevendoroperationalstatus =
    withApiHandler(
        {
            operation: "updatevendoroperationalstatus",
            validator: (request: LambdaRequest) => { validateUpdateOperationalStatusRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendoroperationalstatus(request)
    );
