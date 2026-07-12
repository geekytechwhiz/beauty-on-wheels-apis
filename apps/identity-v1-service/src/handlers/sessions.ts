import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getSessionsController
} from "../controllers/sessions.controller";



const controller =
    getSessionsController();

export const handleGetsessions =
    withApiHandler(
        {
            operation: "getsessions",
        },
        async (request: LambdaRequest) =>
            controller.handleGetsessions(request)
    );

export const handleDeletesessions =
    withApiHandler(
        {
            operation: "deletesessions",
        },
        async (request: LambdaRequest) =>
            controller.handleDeletesessions(request)
    );

export const handleDeletesessionid =
    withApiHandler(
        {
            operation: "deletesessionid",
        },
        async (request: LambdaRequest) =>
            controller.handleDeletesessionid(request)
    );
