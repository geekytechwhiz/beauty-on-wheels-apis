import { LambdaRequest } from "@api-hub/utils";

import {
    AuthenticationService,
    getAuthenticationService
} from "../services/authentication.service";

export class AuthenticationController {

    constructor(

        private readonly service: AuthenticationService =
            getAuthenticationService()

    ) {}



    async handlePostlogin(
        request: LambdaRequest
    ) {

        return this.service.postlogin(
            request
        );

    }



    async handlePostrefreshtoken(
        request: LambdaRequest
    ) {

        return this.service.postrefreshtoken(
            request
        );

    }



    async handlePostlogout(
        request: LambdaRequest
    ) {

        return this.service.postlogout(
            request
        );

    }



    async handlePostchangepassword(
        request: LambdaRequest
    ) {

        return this.service.postchangepassword(
            request
        );

    }

}

let controller: AuthenticationController;

export function getAuthenticationController() {

    if (!controller) {

        controller =
            new AuthenticationController();

    }

    return controller;

}
