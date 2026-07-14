import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getVehiclesController
} from "../controllers/vehicles.controller";

import {
    validateVehicle
} from "../schemas/vehicles.schema";

const controller =
    getVehiclesController();

export const handleGetvehicles =
    withApiHandler(
        {
            operation: "getvehicles",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvehicles(request)
    );

export const handlePostvehicles =
    withApiHandler(
        {
            operation: "postvehicles",
            validator: (request: LambdaRequest) => { validateVehicle(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePostvehicles(request)
    );

export const handleGetvehicleid =
    withApiHandler(
        {
            operation: "getvehicleid",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvehicleid(request)
    );

export const handlePutvehicleid =
    withApiHandler(
        {
            operation: "putvehicleid",
            validator: (request: LambdaRequest) => { validateVehicle(request); }
        },
        async (request: LambdaRequest) =>
            controller.handlePutvehicleid(request)
    );

export const handleDeletevehicleid =
    withApiHandler(
        {
            operation: "deletevehicleid",
        },
        async (request: LambdaRequest) =>
            controller.handleDeletevehicleid(request)
    );

export const handlePutdefault =
    withApiHandler(
        {
            operation: "putdefault",
        },
        async (request: LambdaRequest) =>
            controller.handlePutdefault(request)
    );

export const handleGetvehicletypes =
    withApiHandler(
        {
            operation: "getvehicletypes",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvehicletypes(request)
    );
