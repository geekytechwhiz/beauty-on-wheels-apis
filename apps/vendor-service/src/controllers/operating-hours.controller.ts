import { LambdaRequest } from "@api-hub/utils";

import {
    OperatingHoursService,
    getOperatingHoursService
} from "../services/operating-hours.service";

export class OperatingHoursController {

    constructor(

        private readonly service: OperatingHoursService =
            getOperatingHoursService()

    ) {}



    async handleGetvendoroperatinghours(
        request: LambdaRequest
    ) {

        return this.service.getvendoroperatinghours(
            request
        );

    }



    async handleUpdatevendoroperatinghours(
        request: LambdaRequest
    ) {

        return this.service.updatevendoroperatinghours(
            request
        );

    }

}

let controller: OperatingHoursController;

export function getOperatingHoursController() {

    if (!controller) {

        controller =
            new OperatingHoursController();

    }

    return controller;

}
