import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getCapabilitiesController
} from "../controllers/capabilities.controller";

import {
    validateUpdateVendorCapabilitiesRequest
} from "../schemas/capabilities.schema";

const controller =
    getCapabilitiesController();

export const handleGetvendorcapabilities =
    withApiHandler(
        {
            operation: "getvendorcapabilities",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvendorcapabilities(request)
    );

export const handleUpdatevendorcapabilities =
    withApiHandler(
        {
            operation: "updatevendorcapabilities",
            validator: (request: LambdaRequest) => { validateUpdateVendorCapabilitiesRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendorcapabilities(request)
    );
