import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getRolesController
} from "../controllers/roles.controller";



const controller =
    getRolesController();

export const handleGetroles =
    withApiHandler(
        {
            operation: "getroles",
        },
        async (request: LambdaRequest) =>
            controller.handleGetroles(request)
    );
