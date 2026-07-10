import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getRegistrationController
} from "../controllers/registration.controller";

import {
    validateRegisterRequest
} from "../schemas/registration.schema";

const controller =
    getRegistrationController();

export const handlePostregister =
    withApiHandler(
        {
            operation: "postregister",
            validator: (request: LambdaRequest) => { validateRegisterRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostregister(request)
    );
