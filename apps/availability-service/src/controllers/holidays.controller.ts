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

}

let controller: HolidaysController;

export function getHolidaysController() {

    if (!controller) {

        controller =
            new HolidaysController();

    }

    return controller;

}
