import { LambdaRequest } from "@api-hub/utils";

import {
    VehiclesService,
    getVehiclesService
} from "../services/vehicles.service";

export class VehiclesController {

    constructor(

        private readonly service: VehiclesService =
            getVehiclesService()

    ) {}



    async handleGetvehicles(
        request: LambdaRequest
    ) {

        return this.service.getvehicles(
            request
        );

    }



    async handlePostvehicles(
        request: LambdaRequest
    ) {

        return this.service.postvehicles(
            request
        );

    }



    async handleGetvehicleid(
        request: LambdaRequest
    ) {

        return this.service.getvehicleid(
            request
        );

    }



    async handlePutvehicleid(
        request: LambdaRequest
    ) {

        return this.service.putvehicleid(
            request
        );

    }



    async handleDeletevehicleid(
        request: LambdaRequest
    ) {

        return this.service.deletevehicleid(
            request
        );

    }



    async handlePutdefault(
        request: LambdaRequest
    ) {

        return this.service.putdefault(
            request
        );

    }



    async handleGetvehicletypes(
        request: LambdaRequest
    ) {

        return this.service.getvehicletypes(
            request
        );

    }

}

let controller: VehiclesController;

export function getVehiclesController() {

    if (!controller) {

        controller =
            new VehiclesController();

    }

    return controller;

}
