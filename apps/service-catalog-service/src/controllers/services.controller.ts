import { LambdaRequest } from "@api-hub/utils";

import {
    ServicesService,
    getServicesService
} from "../services/services.service";
import { DiscoverServicesQuery } from "../types/api-types";

export class ServicesController {

    constructor(

        private readonly service: ServicesService =
            getServicesService()

    ) {}



    async handleGetservices(
        request: LambdaRequest
    ) {

        return this.service.getservices(
            request
        );

    }



    async handlePostservices(
        request: LambdaRequest
    ) {

        return this.service.postservices(
            request
        );

    }



    async handleGetserviceid(
        request: LambdaRequest
    ) {

        return this.service.getserviceid(
            request
        );

    }



    async handlePutserviceid(
        request: LambdaRequest
    ) {

        return this.service.putserviceid(
            request
        );

    }



    async handleDeleteserviceid(
        request: LambdaRequest
    ) {

        return this.service.deleteserviceid(
            request
        );

    }

    async handleDiscoverServices(
      request: LambdaRequest
    ) {
        const requestBody: DiscoverServicesQuery ={
            search: request.query?.search,
            categoryId: request.query?.categoryId,
            latitude: request.query?.latitude,
            longitude: request.query?.longitude,
            radiusKm: request.query?.radiusKm,
            vehicleType: request.query?.vehicleType,
            minPrice: request.query?.minPrice,
            maxPrice: request.query?.maxPrice,
            minRating: request.query?.minRating,
            sortBy: request.query?.sortBy,
            limit: request.query?.limit,
            nextToken: request.query?.nextToken,
        }

      return this.service.discoverServices(
        requestBody
      );
    }

}

let controller: ServicesController;

export function getServicesController() {

    if (!controller) {

        controller =
            new ServicesController();

    }

    return controller;

}
