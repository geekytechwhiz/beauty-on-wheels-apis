import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    getCapabilitiesController
} from "../controllers/capabilities.controller";

import {
    validateUpdateVendorCapabilitiesRequest,
    validateReplaceVendorServicesRequest,
    validateReplaceVendorPackagesRequest,
} from "../schemas/capabilities.schema";

const controller =
    getCapabilitiesController();

export const handleGetvendorcapabilities =
    withApiHandler(
        {
            operation: "getvendorcapabilities",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvendorcapabilities(request)
    );

export const handleListavailablecapabilities =
    withApiHandler(
        {
            operation: "listavailablecapabilities",
        },
        async (request: LambdaRequest) =>
            controller.handleListavailablecapabilities(request)
    );

export const handleUpdatevendorcapabilities =
    withApiHandler(
        {
            operation: "updatevendorcapabilities",
            validator: (request: LambdaRequest) => { validateUpdateVendorCapabilitiesRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendorcapabilities(request)
    );

export const handleGetvendorservices = withApiHandler(
  { operation: 'getvendorservices' },
  async (request: LambdaRequest) => controller.handleGetvendorservices(request),
);

export const handleUpdatevendorservices = withApiHandler(
  {
    operation: 'updatevendorservices',
    validator: (request: LambdaRequest) => {
      validateReplaceVendorServicesRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleUpdatevendorservices(request),
);

export const handleGetvendorpackages = withApiHandler(
  { operation: 'getvendorpackages' },
  async (request: LambdaRequest) => controller.handleGetvendorpackages(request),
);

export const handleUpdatevendorpackages = withApiHandler(
  {
    operation: 'updatevendorpackages',
    validator: (request: LambdaRequest) => {
      validateReplaceVendorPackagesRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleUpdatevendorpackages(request),
);
