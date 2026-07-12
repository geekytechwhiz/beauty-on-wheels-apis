import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getBookingsController
} from "../controllers/bookings.controller";

import {
    validateBooking,
    validateBooking
} from "../schemas/bookings.schema";

const controller =
    getBookingsController();

export const handleGetbookings =
    withApiHandler(
        {
            operation: "getbookings",
        },
        async (request: LambdaRequest) =>
            controller.handleGetbookings(request)
    );

export const handlePostbookings =
    withApiHandler(
        {
            operation: "postbookings",
            validator: (request: LambdaRequest) => { validateBooking(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostbookings(request)
    );

export const handleGetbookingid =
    withApiHandler(
        {
            operation: "getbookingid",
        },
        async (request: LambdaRequest) =>
            controller.handleGetbookingid(request)
    );

export const handlePutbookingid =
    withApiHandler(
        {
            operation: "putbookingid",
            validator: (request: LambdaRequest) => { validateBooking(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePutbookingid(request)
    );

export const handleDeletebookingid =
    withApiHandler(
        {
            operation: "deletebookingid",
        },
        async (request: LambdaRequest) =>
            controller.handleDeletebookingid(request)
    );

export const handlePostconfirm =
    withApiHandler(
        {
            operation: "postconfirm",
        },
        async (request: LambdaRequest) =>
            controller.handlePostconfirm(request)
    );

export const handlePostcheckin =
    withApiHandler(
        {
            operation: "postcheckin",
        },
        async (request: LambdaRequest) =>
            controller.handlePostcheckin(request)
    );

export const handlePoststart =
    withApiHandler(
        {
            operation: "poststart",
        },
        async (request: LambdaRequest) =>
            controller.handlePoststart(request)
    );

export const handlePostcomplete =
    withApiHandler(
        {
            operation: "postcomplete",
        },
        async (request: LambdaRequest) =>
            controller.handlePostcomplete(request)
    );

export const handlePostcancel =
    withApiHandler(
        {
            operation: "postcancel",
        },
        async (request: LambdaRequest) =>
            controller.handlePostcancel(request)
    );

export const handleGetbookings =
    withApiHandler(
        {
            operation: "getbookings",
        },
        async (request: LambdaRequest) =>
            controller.handleGetbookings(request)
    );

export const handleGetbookings =
    withApiHandler(
        {
            operation: "getbookings",
        },
        async (request: LambdaRequest) =>
            controller.handleGetbookings(request)
    );
