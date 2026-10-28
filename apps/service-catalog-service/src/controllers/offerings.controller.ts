import { LambdaRequest } from '@api-hub/utils';

import { OfferingsService, getOfferingsService } from '../offerings/offerings.service';
import { OfferingsPage } from '../offerings/types';
import {
  CatalogOfferingsService,
  getCatalogOfferingsService,
  type OfferingApiResponse,
} from '../services/catalog-offerings.service';

export class OfferingsController {
  constructor(
    private readonly discovery: OfferingsService = getOfferingsService(),
    private readonly catalog: CatalogOfferingsService = getCatalogOfferingsService(),
  ) {}

  async handleGetOfferings(request: LambdaRequest): Promise<OfferingsPage> {
    return this.discovery.listOfferings(readOfferingsQuery(request));
  }

  async handleCreateOffering(request: LambdaRequest): Promise<OfferingApiResponse> {
    return this.catalog.create(request);
  }

  async handleGetOffering(request: LambdaRequest): Promise<OfferingApiResponse> {
    return this.catalog.getById(request);
  }

  async handlePatchOffering(request: LambdaRequest): Promise<OfferingApiResponse> {
    return this.catalog.patch(request);
  }

  async handleDeleteOffering(
    request: LambdaRequest,
  ): Promise<{ offeringId: string; status: string }> {
    return this.catalog.archive(request);
  }

  async handleListMyOfferings(request: LambdaRequest): Promise<{
    items: OfferingApiResponse[];
    nextToken?: string;
    total: number;
  }> {
    return this.catalog.listMine(request);
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
