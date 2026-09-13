import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getSessionsController
} from "../controllers/sessions.controller";
import { requireAuth } from "../auth/require-auth";

const controller = getSessionsController();

export const handleGetsessions = withApiHandler(
    {
        operation: "getsessions",
        validator: async (request: LambdaRequest) => {
            await requireAuth(request);
        },
    },
    async (request: LambdaRequest) => controller.handleGetsessions(request),
);

export const handleDeletesessions = withApiHandler(
    {
        operation: "deletesessions",
        validator: async (request: LambdaRequest) => {
            await requireAuth(request);
        },
    },
    async (request: LambdaRequest) => controller.handleDeletesessions(request),
);

export const handleDeletesessionid = withApiHandler(
    {
        operation: "deletesessionid",
        validator: async (request: LambdaRequest) => {
            await requireAuth(request);
        },
    },
    async (request: LambdaRequest) => controller.handleDeletesessionid(request),
);
