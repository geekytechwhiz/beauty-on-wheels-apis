import { APIGatewayProxyResult, APIGatewayProxyEventV2 } from "aws-lambda";
import { orderStatus, PaymentStatus } from "../libs/dtos/orders";
import { getErrorDefinition } from "@api-hub/error-messages";
import { extractLanguageFromEvent } from "@api-hub/utils";
const jwt = require("jsonwebtoken");

export const stripDynamoKeys = <T>(item: T): Partial<T> => {
  const isKeyToRemove = (key: string): boolean => /^(pk|sk)\d*$/i.test(key);

  if (Array.isArray(item)) {
    return item.map(stripDynamoKeys) as unknown as Partial<T>;
  }

  if (item && typeof item === "object") {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(item)) {
      if (!isKeyToRemove(key)) {
        cleaned[key] =
          typeof value === "object" ? stripDynamoKeys(value) : value;
      }
    }
    return cleaned;
  }
  return item;
};

export const successResponse = (
  data: any,
  statusCode = 200,
  message = "successful"
): APIGatewayProxyResult => {
  const result = stripDynamoKeys(data);
  return {
    statusCode,
    body: JSON.stringify({
      success: true,
      message,
      data: result,
    }),
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-Amz-Date",
        "X-Api-Key",
        "X-Amz-Security-Token",
        "X-Amz-User-Agent",
        "Access-Control-Allow-Origin",
      ].join(","),
    },
  };
};

export const errorResponse = (
  message: string,
  errorCode: string,
  statusCode = 500
): APIGatewayProxyResult => {
  return {
    statusCode,
    body: JSON.stringify({
      success: false,
      errorCode,
      message,
    }),
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-Amz-Date",
        "X-Api-Key",
        "X-Amz-Security-Token",
        "X-Amz-User-Agent",
        "Access-Control-Allow-Origin",
      ].join(","),
    },
  };
};

export const decodeToken = async (token: string) => {
  token = token.replace("Bearer", "").trim();
  const decodedJwt = jwt.decode(token, { complete: true });
  return [
    decodedJwt.payload["custom:userID"],
    decodedJwt.payload["custom:organizationID"],
  ];
};

export const getOrderStatusFromPaymentstatus = (
  type: PaymentStatus
): orderStatus => {
  console.log("payment status--", type);
  switch (type) {
    case PaymentStatus.SUCCESS:
      return orderStatus.COMPLETED;
    case PaymentStatus.CANCELLED:
      return orderStatus.CANCELLED;
    case PaymentStatus.REFUNDED:
      return orderStatus.REFUNDED;
    case PaymentStatus.FAILED:
      return orderStatus.FAILED;
    default:
      return orderStatus.CREATED;
  }
};

export const OrderToPaymentStatusMap: Record<orderStatus, PaymentStatus> = {
  [orderStatus.CREATED]: PaymentStatus.INITIATED,
  [orderStatus.COMPLETED]: PaymentStatus.SUCCESS,
  [orderStatus.FAILED]: PaymentStatus.FAILED,
  [orderStatus.CANCELLED]: PaymentStatus.CANCELLED,
  [orderStatus.REFUNDED]: PaymentStatus.REFUNDED,
  [orderStatus.REFUND_INITIATED]: PaymentStatus.REFUND_INITIATED,
  [orderStatus.PARTIALLY_REFUNDED]: PaymentStatus.PARTIALLY_REFUNDED,
};

/**
 * Build error response from error code with language support
 * 
 * @param errorCode - The error code (e.g., "ORDERS.VALIDATION_FAILED")
 * @param statusCode - HTTP status code (default: 500)
 * @param event - API Gateway event to extract language from headers (optional)
 * @param details - Additional error details (optional)
 * @param fallbackMessage - Fallback message if error definition not found (optional)
 * @returns API Gateway proxy result with error response
 */
export const buildErrorResponseFromCode = async (
  errorCode: string,
  statusCode = 500,
  event?: APIGatewayProxyEventV2,
  details?: Record<string, any>,
  fallbackMessage?: string
): Promise<APIGatewayProxyResult> => {
  // Extract language from event headers if provided
  const language = event ? extractLanguageFromEvent(event) : null;
  
  const def = await getErrorDefinition(errorCode, language);
  const body: any = {
    success: false,
    errorCode,
    message: fallbackMessage ?? def?.title ?? "An error occurred.",
  };

  if (def) {
    body.error = def;
  }
  if (details) {
    body.details = details;
  }

  return {
    statusCode,
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-Amz-Date",
        "X-Api-Key",
        "X-Amz-Security-Token",
        "X-Amz-User-Agent",
        "Access-Control-Allow-Origin",
      ].join(","),
    },
  };
};
