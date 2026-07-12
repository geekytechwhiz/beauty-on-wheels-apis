import { LambdaRequest } from "@api-hub/utils";

import {
    PreferencesService,
    getPreferencesService
} from "../services/preferences.service";

export class PreferencesController {

    constructor(

        private readonly service: PreferencesService =
            getPreferencesService()

    ) {}



    async handleGetpreferences(
        request: LambdaRequest
    ) {

        return this.service.getpreferences(
            request
        );

    }



    async handlePutpreferences(
        request: LambdaRequest
    ) {

        return this.service.putpreferences(
            request
        );

    }

}

let controller: PreferencesController;

export function getPreferencesController() {

    if (!controller) {

        controller =
            new PreferencesController();

    }

    return controller;

}
