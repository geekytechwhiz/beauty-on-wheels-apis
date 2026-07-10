import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getOtpController
} from "../controllers/otp.controller";

import {
    validateSendOtpRequest,
    validateVerifyOtpRequest
} from "../schemas/otp.schema";

const controller =
    getOtpController();

export const handlePostsend =
    withApiHandler(
        {
            operation: "postsend",
            validator: (request: LambdaRequest) => { validateSendOtpRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostsend(request)
    );

export const handlePostverify =
    withApiHandler(
        {
            operation: "postverify",
            validator: (request: LambdaRequest) => { validateVerifyOtpRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostverify(request)
    );
