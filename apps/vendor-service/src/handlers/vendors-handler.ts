import { LambdaRequest } from "@api-hub/utils"; 

import {
  getVendorsController
} from "../controllers/vendors.controller";

import {
  validateApproveVendorRequest,
  validateCreateVendorRequest,
  validateRejectVendorRequest,
  validateUpdateOperationalStatusRequest,
  validateUpdateVendorRequest,
  validateUpdateVendorStatusRequest
} from "../schemas/vendors.schema";
import { withApiHandler } from "@api-hub/middleware";

const controller =
    getVendorsController();

 
export const handleCreatevendor =
    withApiHandler(
        {
            operation: "createvendor",
            validator: (request: LambdaRequest) => { validateCreateVendorRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleCreatevendor(request)
    );

export const handleListvendors =
    withApiHandler(
        {
            operation: "listvendors",
        },
        async (request: LambdaRequest) =>
            controller.handleListvendors(request)
    );

export const handleGetvendor =
    withApiHandler(
        {
            operation: "getvendor",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvendor(request)
    );

export const handleGetMyVendor = withApiHandler(
  {
    operation: 'getvendorme',
  },
  async (request: LambdaRequest) => controller.handleGetMyVendor(request),
);

export const handleUpdatevendor =
    withApiHandler(
        {
            operation: "updatevendor",
            validator: (request: LambdaRequest) => { validateUpdateVendorRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendor(request)
    );

export const handleUpdatevendorstatus =
    withApiHandler(
        {
            operation: "updatevendorstatus",
            validator: (request: LambdaRequest) => { validateUpdateVendorStatusRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendorstatus(request)
    );

export const handleUpdatevendoroperationalstatus =
    withApiHandler(
        {
            operation: "updatevendoroperationalstatus",
            validator: (request: LambdaRequest) => { validateUpdateOperationalStatusRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendoroperationalstatus(request)
    );

export const handleApprovevendor = withApiHandler(
  {
    operation: 'approvevendor',
    validator: (request: LambdaRequest) => {
      validateApproveVendorRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleApprovevendor(request),
);

export const handleRejectvendor = withApiHandler(
  {
    operation: 'rejectvendor',
    validator: (request: LambdaRequest) => {
      validateRejectVendorRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleRejectvendor(request),
);

export const handleGetvendorstatushistory = withApiHandler(
  {
    operation: 'getvendorstatushistory',
  },
  async (request: LambdaRequest) =>
    controller.handleGetvendorstatushistory(request),
);
