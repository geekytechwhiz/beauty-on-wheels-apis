import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getSessionsController
} from "../controllers/sessions.controller";

const controller = getSessionsController();

export const handleGetsessions = withApiHandler(
    {
        operation: "getsessions",
        validator: () => undefined,
    },
    async (request: LambdaRequest) => controller.handleGetsessions(request),
);

export const handleDeletesessions = withApiHandler(
    {
        operation: "deletesessions",
        validator: () => undefined,
    },
    async (request: LambdaRequest) => controller.handleDeletesessions(request),
);

export const handleDeletesessionid = withApiHandler(
    {
        operation: "deletesessionid",
        validator: () => undefined,
    },
    async (request: LambdaRequest) => controller.handleDeletesessionid(request),
);
