import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getAuthenticationController
} from "../controllers/authentication.controller";

import {
    validateLoginRequest,
    validateRefreshTokenRequest,
    validateChangePasswordRequest
} from "../schemas/authentication.schema";

const controller =
    getAuthenticationController();

export const handlePostlogin =
    withApiHandler(
        {
            operation: "postlogin",
            validator: (request: LambdaRequest) => { validateLoginRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostlogin(request)
    );

export const handlePostrefreshtoken =
    withApiHandler(
        {
            operation: "postrefreshtoken",
            validator: (request: LambdaRequest) => { validateRefreshTokenRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostrefreshtoken(request)
    );

export const handlePostlogout =
    withApiHandler(
        {
            operation: "postlogout",
        },
        async (request: LambdaRequest) =>
            controller.handlePostlogout(request)
    );

export const handlePostchangepassword =
    withApiHandler(
        {
            operation: "postchangepassword",
            validator: (request: LambdaRequest) => { validateChangePasswordRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostchangepassword(request)
    );
