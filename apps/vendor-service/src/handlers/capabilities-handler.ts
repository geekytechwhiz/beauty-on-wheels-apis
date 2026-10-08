import { withVendorApiHandler } from "./with-vendor-handler";
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
    withVendorApiHandler(
        {
            operation: "getvendorcapabilities",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvendorcapabilities(request)
    );

export const handleListavailablecapabilities =
    withVendorApiHandler(
        {
            operation: "listavailablecapabilities",
        },
        async (request: LambdaRequest) =>
            controller.handleListavailablecapabilities(request)
    );

export const handleUpdatevendorcapabilities =
    withVendorApiHandler(
        {
            operation: "updatevendorcapabilities",
            validator: (request: LambdaRequest) => { validateUpdateVendorCapabilitiesRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendorcapabilities(request)
    );

export const handleGetvendorservices = withVendorApiHandler(
  { operation: 'getvendorservices' },
  async (request: LambdaRequest) => controller.handleGetvendorservices(request),
);

export const handleUpdatevendorservices = withVendorApiHandler(
  {
    operation: 'updatevendorservices',
    validator: (request: LambdaRequest) => {
      validateReplaceVendorServicesRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleUpdatevendorservices(request),
);

export const handleGetvendorpackages = withVendorApiHandler(
  { operation: 'getvendorpackages' },
  async (request: LambdaRequest) => controller.handleGetvendorpackages(request),
);

export const handleUpdatevendorpackages = withVendorApiHandler(
  {
    operation: 'updatevendorpackages',
    validator: (request: LambdaRequest) => {
      validateReplaceVendorPackagesRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleUpdatevendorpackages(request),
);
