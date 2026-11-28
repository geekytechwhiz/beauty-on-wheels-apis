import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { HttpPartnerInternalClient } from '../clients/partner-internal.client';
import {
  assertVendorId,
  parseVendorHomeQuery,
} from '../features/vendor-home/vendor-home.query';
import { VendorHomeService } from '../features/vendor-home/vendor-home.service';
import { resolvePartnerActor } from '../shared/actor';
import { HttpBookingInternalClient } from '../clients/booking-internal.client';

const client = new HttpPartnerInternalClient();
const bookingClient = new HttpBookingInternalClient();
const service = new VendorHomeService(client, bookingClient);

/**
 * Approved vendor-home BFF surface.
 * Route retained as GET /partner/{vendorId}/manager/home for compatibility.
 * operationId: getVendorHome (serverless documentation) / partnerManagerHome (runtime).
 */
export const handleManagerHome = withApiHandler(
  { operation: 'getVendorHome' },
  async (request: LambdaRequest) => {
    assertVendorId(request.pathParameters?.vendorId);
    const actor = await resolvePartnerActor(request, client);
    const query = parseVendorHomeQuery(request.params as Record<string, unknown>);
    return service.get(actor, query);
  },
);
export const handleVendorHome = withApiHandler(
  { operation: 'getVendorHome' },
  async (request: LambdaRequest) => {
    assertVendorId(request.pathParameters?.vendorId);
    return service.getVendorHome(
      request.pathParameters?.vendorId as string,
      request.context.authHeader,
    );
  },
);