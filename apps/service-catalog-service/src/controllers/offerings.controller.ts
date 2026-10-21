import { LambdaRequest } from '@api-hub/utils';

import { OfferingsService, getOfferingsService } from '../offerings/offerings.service';
import { OfferingsPage } from '../offerings/types';

export class OfferingsController {
  constructor(
    private readonly service: OfferingsService = getOfferingsService(),
  ) {}

  async handleGetOfferings(request: LambdaRequest): Promise<OfferingsPage> {
    return this.service.listOfferings(readOfferingsQuery(request));
  }
}

/**
 * Query values arrive on `params`. Repeated `filter` values arrive on the
 * API Gateway multi-value map when the event still has them.
 */
export function readOfferingsQuery(request: LambdaRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {
    ...(request.query ?? {}),
    ...(request.params ?? {}),
  };
  const repeated = request.event?.multiValueQueryStringParameters?.filter;
  if (Array.isArray(repeated) && repeated.length > 0) {
    params.filter = repeated.length === 1 ? repeated[0] : repeated;
  }
  return params;
}

let controller: OfferingsController | undefined;

export function getOfferingsController(): OfferingsController {
  if (!controller) {
    controller = new OfferingsController();
  }
  return controller;
}
