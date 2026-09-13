import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getOperatingHoursController
} from "../controllers/operating-hours.controller";

import {
    validateUpdateVendorOperatingHoursRequest
} from "../schemas/operating-hours.schema";

const controller =
    getOperatingHoursController();

export const handleGetvendoroperatinghours =
    withApiHandler(
        {
            operation: "getvendoroperatinghours",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvendoroperatinghours(request)
    );

export const handleUpdatevendoroperatinghours =
    withApiHandler(
        {
            operation: "updatevendoroperatinghours",
            validator: (request: LambdaRequest) => { validateUpdateVendorOperatingHoursRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendoroperatinghours(request)
    );
