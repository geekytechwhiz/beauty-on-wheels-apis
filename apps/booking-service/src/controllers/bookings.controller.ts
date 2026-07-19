import { LambdaRequest } from "@api-hub/utils";

import {
    BookingsService,
    getBookingsService
} from "../services/bookings.service";

export class BookingsController {

    constructor(

        private readonly service: BookingsService =
            getBookingsService()

    ) {}



    async handleGetbookings(
        request: LambdaRequest
    ) {
        // params merges path + query (e.g. /bookings?customerId=x or /customers/{customerId}/bookings)
        const customerId = request.params?.customerId as string | undefined;
        const vendorId = request.params?.vendorId as string | undefined;

        return this.service.getbookings({
            customerId,
            vendorId,
            correlationId: (request.context as { correlationId?: string })?.correlationId,
        });

    }



    async handlePostbookings(
        request: LambdaRequest
    ) {

        return this.service.postbookings(
            request
        );

    }



    async handleGetbookingid(
        request: LambdaRequest
    ) {

        return this.service.getbookingid(
            request
        );

    }



    async handlePutbookingid(
        request: LambdaRequest
    ) {

        return this.service.putbookingid(
            request
        );

    }



    async handleDeletebookingid(
        request: LambdaRequest
    ) {

        return this.service.deletebookingid(
            request
        );

    }



    async handlePostconfirm(
        request: LambdaRequest
    ) {

        return this.service.postconfirm(
            request
        );

    }



    async handlePostcheckin(
        request: LambdaRequest
    ) {

        return this.service.postcheckin(
            request
        );

    }



    async handlePoststart(
        request: LambdaRequest
    ) {

        return this.service.poststart(
            request
        );

    }



    async handlePostcomplete(
        request: LambdaRequest
    ) {

        return this.service.postcomplete(
            request
        );

    }



    async handlePostcancel(
        request: LambdaRequest
    ) {

        return this.service.postcancel(
            request
        );

    }
}

let controller: BookingsController;

export function getBookingsController() {

    if (!controller) {

        controller =
            new BookingsController();

    }

    return controller;

}
