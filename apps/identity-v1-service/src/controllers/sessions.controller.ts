import { LambdaRequest } from "@api-hub/utils";

import {
    SessionsService,
    getSessionsService
} from "../services/sessions.service";

export class SessionsController {

    constructor(

        private readonly service: SessionsService =
            getSessionsService()

    ) {}



    async handleGetsessions(
        request: LambdaRequest
    ) {

        return this.service.getsessions(
            request
        );

    }



    async handleDeletesessions(
        request: LambdaRequest
    ) {

        return this.service.deletesessions(
            request
        );

    }



    async handleDeletesessionid(
        request: LambdaRequest
    ) {

        return this.service.deletesessionid(
            request
        );

    }

}

let controller: SessionsController;

export function getSessionsController() {

    if (!controller) {

        controller =
            new SessionsController();

    }

    return controller;

}
