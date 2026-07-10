import { LambdaRequest } from "@api-hub/utils";

import {
    OtpService,
    getOtpService
} from "../services/otp.service";

export class OtpController {

    constructor(

        private readonly service: OtpService =
            getOtpService()

    ) {}



    async handlePostsend(
        request: LambdaRequest
    ) {

        return this.service.postsend(
            request
        );

    }



    async handlePostverify(
        request: LambdaRequest
    ) {

        return this.service.postverify(
            request
        );

    }

}

let controller: OtpController;

export function getOtpController() {

    if (!controller) {

        controller =
            new OtpController();

    }

    return controller;

}
