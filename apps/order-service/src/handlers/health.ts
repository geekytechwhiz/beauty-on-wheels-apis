// import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import { createLogger, extractCorrelationId, extractAwsRequestId, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda/trigger/api-gateway-proxy";
import { Context } from "aws-lambda";

const baseLogger = createLogger({ service: 'order-service', redactPII: true });

const base = middy(async (event: APIGatewayProxyEventV2, context?: Context): Promise<APIGatewayProxyResultV2> => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  
  logger.info({ event: 'health_check_received' });
  console.log(" event.requestContext", event.requestContext)
  const body = {
    status: "ok",
    service: "order-service",
    version: process.env.npm_package_version ?? "dev",
    time: new Date().toISOString(),
  };
  
  const duration = Date.now() - startTime;
  logHttpRequest(logger, event.requestContext?.http?.method || 'GET', event.rawPath || '/health', 200, duration, correlationId);
  
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
});

export const healthCheck = base.use(httpCors() as any);
