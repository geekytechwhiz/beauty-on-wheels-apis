import { LambdaRequest } from "@api-hub/utils";

import {
    HolidaysService,
    getHolidaysService
} from "../services/holidays.service";

export class HolidaysController {

    constructor(

        private readonly service: HolidaysService =
            getHolidaysService()

    ) {}



    async handlePostslotholds(
        request: LambdaRequest
    ) {

        return this.service.postslotholds(
            request
        );

    }



    async handleDeleteslothold(
        request: LambdaRequest
    ) {

        return this.service.deleteslothold(
            request
        );

    }



    async handleGetslothold(
        request: LambdaRequest
    ) {

        return this.service.getslothold(
            request
        );

    }



    async handleGetholidays(
        request: LambdaRequest
    ) {

        return this.service.getholidays(
            request
        );

    }



    async handlePostholidays(
        request: LambdaRequest
    ) {

        return this.service.postholidays(
            request
        );

    }



    async handlePatchholiday(
        request: LambdaRequest
    ) {

        return this.service.patchholiday(
            request
        );

    }



    async handleDeleteholiday(
        request: LambdaRequest
    ) {

        return this.service.deleteholiday(
            request
        );

    }

}

let controller: HolidaysController;

export function getHolidaysController() {

    if (!controller) {

        controller =
            new HolidaysController();

    }

    return controller;

}
