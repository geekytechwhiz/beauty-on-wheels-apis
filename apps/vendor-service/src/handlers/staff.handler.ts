import { withApiHandler } from "@api-hub/middleware";
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
    withApiHandler(
        {
            operation: "listvendorstaff",
        },
        async (request: LambdaRequest) =>
            controller.handleListvendorstaff(request)
    );

export const handleCreatevendorstaff =
    withApiHandler(
        {
            operation: "createvendorstaff",
            validator: (request: LambdaRequest) => { validateCreateStaffRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleCreatevendorstaff(request)
    );

export const handleGetvendorstaff =
    withApiHandler(
        {
            operation: "getvendorstaff",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvendorstaff(request)
    );

export const handleUpdatevendorstaff =
    withApiHandler(
        {
            operation: "updatevendorstaff",
            validator: (request: LambdaRequest) => { validateUpdateStaffRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendorstaff(request)
    );

export const handleDeactivatevendorstaff =
    withApiHandler(
        {
            operation: "deactivatevendorstaff",
        },
        async (request: LambdaRequest) =>
            controller.handleDeactivatevendorstaff(request)
    );
