import { withVendorApiHandler } from "./with-vendor-handler";
import { LambdaRequest } from "@api-hub/utils";

import {
    getStaffController
} from "../controllers/staff.controller";

import {
    validateCreateStaffRequest,
    validateUpdateStaffRequest
} from "../schemas/staff.schema";

const controller =
    getStaffController();

export const handleListvendorstaff =
    withVendorApiHandler(
        {
            operation: "listvendorstaff",
        },
        async (request: LambdaRequest) =>
            controller.handleListvendorstaff(request)
    );

export const handleCreatevendorstaff =
    withVendorApiHandler(
        {
            operation: "createvendorstaff",
            validator: (request: LambdaRequest) => { validateCreateStaffRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleCreatevendorstaff(request)
    );

export const handleGetvendorstaff =
    withVendorApiHandler(
        {
            operation: "getvendorstaff",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvendorstaff(request)
    );

export const handleUpdatevendorstaff =
    withVendorApiHandler(
        {
            operation: "updatevendorstaff",
            validator: (request: LambdaRequest) => { validateUpdateStaffRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendorstaff(request)
    );

export const handleDeactivatevendorstaff =
    withVendorApiHandler(
        {
            operation: "deactivatevendorstaff",
        },
        async (request: LambdaRequest) =>
            controller.handleDeactivatevendorstaff(request)
    );
