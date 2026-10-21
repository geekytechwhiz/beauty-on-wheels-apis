import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getKycController
} from "../controllers/kyc.controller";



const controller =
    getKycController();

export const handlePostkyc =
    withApiHandler(
        {
            operation: "postkyc",
        },
        async (request: LambdaRequest) =>
            controller.handlePostkyc(request)
    );

export const handleGetkyc =
    withApiHandler(
        {
            operation: "getkyc",
        },
        async (request: LambdaRequest) =>
            controller.handleGetkyc(request)
    );
