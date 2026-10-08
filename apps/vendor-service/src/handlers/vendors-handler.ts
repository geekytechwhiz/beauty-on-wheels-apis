import { withVendorApiHandler } from "./with-vendor-handler";
import { LambdaRequest } from "@api-hub/utils";

import {
    getVendorsController
} from "../controllers/vendors.controller";

import {
    validateCreateVendorRequest,
    validateUpdateVendorRequest,
    validateUpdateVendorStatusRequest,
    validateUpdateOperationalStatusRequest,
    validateRegisterVendorRequest,
    validateApproveVendorRequest,
    validateRejectVendorRequest,
} from "../schemas/vendors.schema";

const controller =
    getVendorsController();

    export const handleRegisterVendor = withVendorApiHandler(
      {
        operation: 'registervendor',
        validator: (request: LambdaRequest) => {
          validateRegisterVendorRequest(request);
        },
      },
      async (request: LambdaRequest) => controller.handleRegisterVendor(request),
    );

export const handleCreatevendor =
    withVendorApiHandler(
        {
            operation: "createvendor",
            validator: (request: LambdaRequest) => { validateCreateVendorRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleCreatevendor(request)
    );

export const handleListvendors =
    withVendorApiHandler(
        {
            operation: "listvendors",
        },
        async (request: LambdaRequest) =>
            controller.handleListvendors(request)
    );

export const handleGetvendor =
    withVendorApiHandler(
        {
            operation: "getvendor",
        },
        async (request: LambdaRequest) =>
            controller.handleGetvendor(request)
    );

export const handleGetMyVendor = withVendorApiHandler(
  {
    operation: 'getvendorme',
  },
  async (request: LambdaRequest) => controller.handleGetMyVendor(request),
);

export const handleUpdatevendor =
    withVendorApiHandler(
        {
            operation: "updatevendor",
            validator: (request: LambdaRequest) => { validateUpdateVendorRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendor(request)
    );

export const handleUpdatevendorstatus =
    withVendorApiHandler(
        {
            operation: "updatevendorstatus",
            validator: (request: LambdaRequest) => { validateUpdateVendorStatusRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendorstatus(request)
    );

export const handleUpdatevendoroperationalstatus =
    withVendorApiHandler(
        {
            operation: "updatevendoroperationalstatus",
            validator: (request: LambdaRequest) => { validateUpdateOperationalStatusRequest(request); }
        },
        async (request: LambdaRequest) =>
            controller.handleUpdatevendoroperationalstatus(request)
    );

export const handleApprovevendor = withVendorApiHandler(
  {
    operation: 'approvevendor',
    validator: (request: LambdaRequest) => {
      validateApproveVendorRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleApprovevendor(request),
);

export const handleRejectvendor = withVendorApiHandler(
  {
    operation: 'rejectvendor',
    validator: (request: LambdaRequest) => {
      validateRejectVendorRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleRejectvendor(request),
);

export const handleGetvendorstatushistory = withVendorApiHandler(
  {
    operation: 'getvendorstatushistory',
  },
  async (request: LambdaRequest) =>
    controller.handleGetvendorstatushistory(request),
);
