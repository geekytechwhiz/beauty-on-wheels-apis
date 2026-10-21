import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getVendorsController
} from "../controllers/vendors.controller";

import {
    validateVendorProfile
} from "../schemas/vendors.schema";

const controller =
    getVendorsController();

export const handleGetuserid =
    withApiHandler(
        {
            operation: "getuserid",
        },
        async (request: LambdaRequest) =>
            controller.handleGetuserid(request)
    );

export const handlePutuserid =
    withApiHandler(
        {
            operation: "putuserid",
            validator: (request: LambdaRequest) => { validateVendorProfile(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePutuserid(request)
    );
