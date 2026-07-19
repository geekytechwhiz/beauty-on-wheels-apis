import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getPackagesController
} from "../controllers/packages.controller";

import {
    validatePackage,
    validatePackageUpdate,
} from "../schemas/packages.schema";

const controller =
    getPackagesController();

export const handleGetpackages =
    withApiHandler(
        {
            operation: "getpackages",
        },
        async (request: LambdaRequest) =>
            controller.handleGetpackages(request)
    );

export const handlePostpackages =
    withApiHandler(
        {
            operation: "postpackages",
            validator: (request: LambdaRequest) => { validatePackage(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostpackages(request)
    );

export const handleGetpackageid =
    withApiHandler(
        {
            operation: "getpackageid",
        },
        async (request: LambdaRequest) =>
            controller.handleGetpackageid(request)
    );

export const handlePutpackageid =
    withApiHandler(
        {
            operation: "putpackageid",
            validator: (request: LambdaRequest) => { validatePackageUpdate(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePutpackageid(request)
    );

export const handleDeletepackageid =
    withApiHandler(
        {
            operation: "deletepackageid",
        },
        async (request: LambdaRequest) =>
            controller.handleDeletepackageid(request)
    );
