import { LambdaRequest } from "@api-hub/utils";

import {
    RegistrationService,
    getRegistrationService
} from "../services/registration.service";

export class RegistrationController {

    constructor(

        private readonly service: RegistrationService =
            getRegistrationService()

    ) {}



    async handlePostregister(
        request: LambdaRequest
    ) {

        return this.service.postregister(
            request
        );

    }

}

let controller: RegistrationController;

export function getRegistrationController() {

    if (!controller) {

        controller =
            new RegistrationController();

    }

    return controller;

}
