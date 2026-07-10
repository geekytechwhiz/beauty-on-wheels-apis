import { LambdaRequest } from "@api-hub/utils";

import {
    RolesService,
    getRolesService
} from "../services/roles.service";

export class RolesController {

    constructor(

        private readonly service: RolesService =
            getRolesService()

    ) {}



    async handleGetroles(
        request: LambdaRequest
    ) {

        return this.service.getroles(
            request
        );

    }

}

let controller: RolesController;

export function getRolesController() {

    if (!controller) {

        controller =
            new RolesController();

    }

    return controller;

}
