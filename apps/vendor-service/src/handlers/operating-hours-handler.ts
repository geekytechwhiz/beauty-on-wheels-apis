import { withVendorApiHandler } from "./with-vendor-handler";
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
    withVendorApiHandler(
        {
            operation: "getvendoroperatinghours",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvendoroperatinghours(request)
    );

export const handleUpdatevendoroperatinghours =
    withVendorApiHandler(
        {
            operation: "updatevendoroperatinghours",
            validator: (request: LambdaRequest) => { validateUpdateVendorOperatingHoursRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendoroperatinghours(request)
    );
