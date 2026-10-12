import { withApiHandler } from "@api-hub/middleware";
import { createdResponse, LambdaRequest } from "@api-hub/utils";

import {
    getHolidaysController
} from "../controllers/holidays.controller";



const controller =
    getHolidaysController();

export const handlePostslotholds =
    withApiHandler(
        {
            operation: "postslotholds",
            useLegacyResponseFormat: true,
        },
        async (request: LambdaRequest) =>
            createdResponse(
                await controller.handlePostslotholds(request),
                undefined,
                { correlationId: request.context.correlationId },
            )
    );

export const handleDeleteslothold =
    withApiHandler(
        {
            operation: "deleteslothold",
        },
        async (request: LambdaRequest) =>
            controller.handleDeleteslothold(request)
    );

export const handleGetslothold =
    withApiHandler(
        {
            operation: "getslothold",
        },
        async (request: LambdaRequest) =>
            controller.handleGetslothold(request)
    );

export const handleGetholidays =
    withApiHandler(
        {
            operation: "getholidays",
        },
        async (request: LambdaRequest) =>
            controller.handleGetholidays(request)
    );

export const handlePostholidays =
    withApiHandler(
        {
            operation: "postholidays",
        },
        async (request: LambdaRequest) =>
            controller.handlePostholidays(request)
    );

export const handlePatchholiday =
    withApiHandler(
        {
            operation: "patchholiday",
        },
        async (request: LambdaRequest) =>
            controller.handlePatchholiday(request)
    );

export const handleDeleteholiday =
    withApiHandler(
        {
            operation: "deleteholiday",
        },
        async (request: LambdaRequest) =>
            controller.handleDeleteholiday(request)
    );
