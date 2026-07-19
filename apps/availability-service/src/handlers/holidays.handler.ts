import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getHolidaysController
} from "../controllers/holidays.controller";



const controller =
    getHolidaysController();

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
