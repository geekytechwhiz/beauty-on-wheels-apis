import { LambdaRequest } from "@api-hub/utils";

import {
    UsersService,
    getUsersService
} from "../services/users.service";

export class UsersController {

    constructor(

        private readonly service: UsersService =
            getUsersService()

    ) {}



    async handleGetusers(
        request: LambdaRequest
    ) {

        return this.service.getusers(
            request
        );

    }



    async handlePostusers(
        request: LambdaRequest
    ) {

        return this.service.postusers(
            request
        );

    }



    async handleGetuserid(
        request: LambdaRequest
    ) {

        return this.service.getuserid(
            request
        );

    }



    async handlePutuserid(
        request: LambdaRequest
    ) {

        return this.service.putuserid(
            request
        );

    }



    async handleDeleteuserid(
        request: LambdaRequest
    ) {

        return this.service.deleteuserid(
            request
        );

    }

}

let controller: UsersController;

export function getUsersController() {

    if (!controller) {

        controller =
            new UsersController();

    }

    return controller;

}
