import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getCategoriesController
} from "../controllers/categories.controller";

import {
    validateCategory,
    validateCategoryUpdate,
} from "../schemas/categories.schema";

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
            validator: (request: LambdaRequest) => { validateCategory(request); }
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
            validator: (request: LambdaRequest) => { validateCategoryUpdate(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePutcategoryid(request)
    );

export const handleDeletecategoryid =
    withApiHandler(
        {
            operation: "deletecategoryid",
        },
        async (request: LambdaRequest) =>
            controller.handleDeletecategoryid(request)
    );
