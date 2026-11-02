import { withVendorApiHandler } from "./with-vendor-handler";
import { LambdaRequest } from "@api-hub/utils";

import {
    getCapabilitiesController
} from "../controllers/capabilities.controller";

import {
    validateUpdateVendorCapabilitiesRequest,
} from "../schemas/capabilities.schema";

const controller =
    getCapabilitiesController();

export const handleGetvendorcapabilities =
    withVendorApiHandler(
        {
            operation: "getvendorcapabilities",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvendorcapabilities(request)
    );

export const handleListavailablecapabilities =
    withVendorApiHandler(
        {
            operation: "listavailablecapabilities",
        },
        async (request: LambdaRequest) =>
            controller.handleListavailablecapabilities(request)
    );

export const handleUpdatevendorcapabilities =
    withVendorApiHandler(
        {
            operation: "updatevendorcapabilities",
            validator: (request: LambdaRequest) => { validateUpdateVendorCapabilitiesRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendorcapabilities(request)
    );

