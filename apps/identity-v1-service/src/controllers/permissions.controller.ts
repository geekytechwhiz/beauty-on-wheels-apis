import { LambdaRequest } from "@api-hub/utils";

import {
    PermissionsService,
    getPermissionsService
} from "../services/permissions.service";

export class PermissionsController {

    constructor(

        private readonly service: PermissionsService =
            getPermissionsService()

    ) {}



    async handleGetpermissions(
        request: LambdaRequest
    ) {

        return this.service.getpermissions(
            request
        );

    }

}

let controller: PermissionsController;

export function getPermissionsController() {

    if (!controller) {

        controller =
            new PermissionsController();

    }

    return controller;

}
