import { LambdaRequest } from "@api-hub/utils";

import {
    KycService,
    getKycService
} from "../services/kyc.service";

export class KycController {

    constructor(

        private readonly service: KycService =
            getKycService()

    ) {}



    async handlePostkyc(
        request: LambdaRequest
    ) {

        return this.service.postkyc(
            request
        );

    }



    async handleGetkyc(
        request: LambdaRequest
    ) {

        return this.service.getkyc(
            request
        );

    }

}

let controller: KycController;

export function getKycController() {

    if (!controller) {

        controller =
            new KycController();

    }

    return controller;

}
