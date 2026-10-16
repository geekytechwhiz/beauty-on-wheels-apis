import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";
import { getServicesController } from "../controllers/services.controller";
const controller = getServicesController();
export const discoverServicesHandler = withApiHandler(
  {
    operation: 'discoverServices',
  },
  async (request: LambdaRequest) => controller.handleDiscoverServices(request),
);
