import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getAddOnsController
} from "../controllers/add-ons.controller";

import {
    validateAddOn,
    validateAddOnUpdate,
} from "../schemas/add-ons.schema";
import { assertCatalogAdmin } from "../utils/helpers/catalog-admin";

const controller =
    getAddOnsController();

export const handleGetaddons =
    withApiHandler(
        {
            operation: "getaddons",
        },
        async (request: LambdaRequest) =>
            controller.handleGetaddons(request)
    );

export const handlePostaddons =
    withApiHandler(
        {
            operation: "postaddons",
            validator: (request: LambdaRequest) => {
                assertCatalogAdmin(request);
                validateAddOn(request);
            }
        },
        async (request: LambdaRequest) =>
            controller.handlePostaddons(request)
    );

export const handleGetaddonid =
    withApiHandler(
        {
            operation: "getaddonid",
        },
        async (request: LambdaRequest) =>
            controller.handleGetaddonid(request)
    );

export const handlePutaddonid =
    withApiHandler(
        {
            operation: "putaddonid",
            validator: (request: LambdaRequest) => {
                assertCatalogAdmin(request);
                validateAddOnUpdate(request);
            }
        },
        async (request: LambdaRequest) =>
            controller.handlePutaddonid(request)
    );

export const handleDeleteaddonid =
    withApiHandler(
        {
            operation: "deleteaddonid",
            validator: (request: LambdaRequest) => {
                assertCatalogAdmin(request);
            },
        },
        async (request: LambdaRequest) =>
            controller.handleDeleteaddonid(request)
    );
