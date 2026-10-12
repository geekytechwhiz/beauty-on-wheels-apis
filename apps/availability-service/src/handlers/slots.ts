import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getSlotsController
} from "../controllers/slots.controller";



const controller =
    getSlotsController();

export const handleGetslots =
    withApiHandler(
        {
            operation: "getslots",
        },
        async (request: LambdaRequest) =>
            controller.handleGetslots(request)
    );

export const handlePostslots =
    withApiHandler(
        {
            operation: "postslots",
        },
        async (request: LambdaRequest) =>
            controller.handlePostslots(request)
    );

export const handleGetslotid =
    withApiHandler(
        {
            operation: "getslotid",
        },
        async (request: LambdaRequest) =>
            controller.handleGetslotid(request)
    );

export const handlePostblock =
    withApiHandler(
        {
            operation: "postblock",
        },
        async (request: LambdaRequest) =>
            controller.handlePostblock(request)
    );

export const handlePostunblock =
    withApiHandler(
        {
            operation: "postunblock",
        },
        async (request: LambdaRequest) =>
            controller.handlePostunblock(request)
    );
