import { LambdaRequest } from "@api-hub/utils";

import {
    CategoriesService,
    getCategoriesService
} from "../services/categories.service";

export class CategoriesController {

    constructor(

        private readonly service: CategoriesService =
            getCategoriesService()

    ) {}



    async handleGetcategories(
        request: LambdaRequest
    ) {

        return this.service.getcategories(
            request
        );

    }



    async handlePostcategories(
        request: LambdaRequest
    ) {

        return this.service.postcategories(
            request
        );

    }



    async handleGetcategoryid(
        request: LambdaRequest
    ) {

        return this.service.getcategoryid(
            request
        );

    }



    async handlePutcategoryid(
        request: LambdaRequest
    ) {

        return this.service.putcategoryid(
            request
        );

    }



    async handleDeletecategoryid(
        request: LambdaRequest
    ) {

        return this.service.deletecategoryid(
            request
        );

    }

}

let controller: CategoriesController;

export function getCategoriesController() {

    if (!controller) {

        controller =
            new CategoriesController();

    }

    return controller;

}
