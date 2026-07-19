import { LambdaRequest } from "@api-hub/utils";

import {
    StaffService,
    getStaffService
} from "../services/staff.service";

export class StaffController {

    constructor(

        private readonly service: StaffService =
            getStaffService()

    ) {}



    async handleListvendorstaff(
        request: LambdaRequest
    ) {

        return this.service.listvendorstaff(
            request
        );

    }



    async handleCreatevendorstaff(
        request: LambdaRequest
    ) {

        return this.service.createvendorstaff(
            request
        );

    }



    async handleGetvendorstaff(
        request: LambdaRequest
    ) {

        return this.service.getvendorstaff(
            request
        );

    }



    async handleUpdatevendorstaff(
        request: LambdaRequest
    ) {

        return this.service.updatevendorstaff(
            request
        );

    }



    async handleDeactivatevendorstaff(
        request: LambdaRequest
    ) {

        return this.service.deactivatevendorstaff(
            request
        );

    }

}

let controller: StaffController;

export function getStaffController() {

    if (!controller) {

        controller =
            new StaffController();

    }

    return controller;

}
