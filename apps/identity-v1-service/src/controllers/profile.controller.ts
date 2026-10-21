import { LambdaRequest } from "@api-hub/utils";

import {
    ProfileService,
    getProfileService
} from "../services/profile.service";

export class ProfileController {

    constructor(

        private readonly service: ProfileService =
            getProfileService()

    ) {}



    async handleGetme(
        request: LambdaRequest
    ) {

        return this.service.getme(
            request
        );

    }

    async handleGetProvisioningStatus(
        request: LambdaRequest
    ) {
        return this.service.getProvisioningStatus(request);
    }

}

let controller: ProfileController;

export function getProfileController() {

    if (!controller) {

        controller =
            new ProfileController();

    }

    return controller;

}
