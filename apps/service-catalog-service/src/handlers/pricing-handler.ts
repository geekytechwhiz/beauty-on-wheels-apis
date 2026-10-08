import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import { getPricingController } from "../controllers/pricing.controller";
import { validatePricingRequest } from "../schemas/pricing.schema";

const controller = getPricingController();

export const handlePostpricingcalculate = withApiHandler(
  {
    operation: "postpricingcalculate",
    validator: (request: LambdaRequest) => {
      validatePricingRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handlePostpricingcalculate(request),
);
