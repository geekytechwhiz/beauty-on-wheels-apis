import middy from "@middy/core";
import httpJsonBodyParser from "@middy/http-json-body-parser";
import httpErrorHandler from "@middy/http-error-handler";
import httpCors from "@middy/http-cors";
import { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { OrdersController } from "../controllers/orders.controller";

const controller = new OrdersController();

const baseMiddlewares = () => [
  httpJsonBodyParser(),
  httpCors(),
  httpErrorHandler()
];

const wrap = (fn: (e: APIGatewayProxyEventV2, c?: Context) => any) => {
  const h = middy(fn);
  baseMiddlewares().forEach(m => h.use(m as any));
  return h;
};

export const createOrder = wrap(async (e: APIGatewayProxyEventV2, c?: Context) =>
  controller.handleCreateOrgOrder(e, c)
);
export const getOrder = wrap(async (e: APIGatewayProxyEventV2, c?: Context) =>
  controller.handleGetOrder(e, c)
);
export const listOrders = wrap(async (e: APIGatewayProxyEventV2, c?: Context) =>
  controller.handleListOrders(e, c)
);
export const requestPayment = wrap(async (e: APIGatewayProxyEventV2, c?: Context) =>
  controller.handleRequestPayment(e, c)
);
export const paymentEvents = wrap(async (e: APIGatewayProxyEventV2, c?: Context) =>
  controller.handlePaymentEvents(e, c)
);
export const cancelOrder = wrap(async (e: APIGatewayProxyEventV2, c?: Context) =>
  controller.handleCancelOrder(e, c)
);
export const refundPayment = wrap(async (e: APIGatewayProxyEventV2, c?: Context) =>
  controller.handleRefundPayment(e, c)
);
export const createPharmacyOrder = wrap(async (e: APIGatewayProxyEventV2, c?: Context) =>
  controller.handleCreatePharmacyOrder(e, c)
);
export const markPaid = wrap(async (e: APIGatewayProxyEventV2, c?: Context) =>
  controller.handleMarkPaid(e, c)
);
export const generateInvoice = wrap(async (e: APIGatewayProxyEventV2, c?: Context) =>
  controller.handleGenerateInvoice(e, c)
);
export const getPaymentStatus = wrap(async (e: APIGatewayProxyEventV2, c?: Context) =>
  controller.handleGetPaymentStatus(e, c)
);
export const getOrderById = wrap(async (e: APIGatewayProxyEventV2, c?: Context) =>
  controller.handleGetOrderById(e, c)
);