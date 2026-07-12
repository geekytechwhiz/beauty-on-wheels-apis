import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getUsersController
} from "../controllers/users.controller";

import {
    validateUser,
    validateUser
} from "../schemas/users.schema";

const controller =
    getUsersController();

export const handleGetusers =
    withApiHandler(
        {
            operation: "getusers",
        },
        async (request: LambdaRequest) =>
            controller.handleGetusers(request)
    );

export const handlePostusers =
    withApiHandler(
        {
            operation: "postusers",
            validator: (request: LambdaRequest) => { validateUser(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostusers(request)
    );

export const handleGetuserid =
    withApiHandler(
        {
            operation: "getuserid",
        },
        async (request: LambdaRequest) =>
            controller.handleGetuserid(request)
    );

export const handlePutuserid =
    withApiHandler(
        {
            operation: "putuserid",
            validator: (request: LambdaRequest) => { validateUser(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePutuserid(request)
    );

export const handleDeleteuserid =
    withApiHandler(
        {
            operation: "deleteuserid",
        },
        async (request: LambdaRequest) =>
            controller.handleDeleteuserid(request)
    );
