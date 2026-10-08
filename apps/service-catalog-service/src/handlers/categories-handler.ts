import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getCategoriesController
} from "../controllers/categories.controller";

import {
    validateCategory,
    validateCategoryUpdate,
} from "../schemas/categories.schema";
import { assertCatalogAdmin } from "../utils/helpers/catalog-admin";

const controller =
    getCategoriesController();

export const handleGetcategories =
    withApiHandler(
        {
            operation: "getcategories",
        },
        async (request: LambdaRequest) =>
            controller.handleGetcategories(request)
    );

export const handlePostcategories =
    withApiHandler(
        {
            operation: "postcategories",
            validator: (request: LambdaRequest) => {
                assertCatalogAdmin(request);
                validateCategory(request);
            }
        },
        async (request: LambdaRequest) =>
            controller.handlePostcategories(request)
    );

export const handleGetcategoryid =
    withApiHandler(
        {
            operation: "getcategoryid",
        },
        async (request: LambdaRequest) =>
            controller.handleGetcategoryid(request)
    );

export const handlePutcategoryid =
    withApiHandler(
        {
            operation: "putcategoryid",
            validator: (request: LambdaRequest) => {
                assertCatalogAdmin(request);
                validateCategoryUpdate(request);
            }
        },
        async (request: LambdaRequest) =>
            controller.handlePutcategoryid(request)
    );

export const handleDeletecategoryid =
    withApiHandler(
        {
            operation: "deletecategoryid",
            validator: (request: LambdaRequest) => {
                assertCatalogAdmin(request);
            },
        },
        async (request: LambdaRequest) =>
            controller.handleDeletecategoryid(request)
    );
