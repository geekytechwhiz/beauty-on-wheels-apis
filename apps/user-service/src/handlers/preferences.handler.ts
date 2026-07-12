import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getPreferencesController
} from "../controllers/preferences.controller";

import {
    validatePreference
} from "../schemas/preferences.schema";

const controller =
    getPreferencesController();

export const handleGetpreferences =
    withApiHandler(
        {
            operation: "getpreferences",
        },
        async (request: LambdaRequest) =>
            controller.handleGetpreferences(request)
    );

export const handlePutpreferences =
    withApiHandler(
        {
            operation: "putpreferences",
            validator: (request: LambdaRequest) => { validatePreference(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePutpreferences(request)
    );
