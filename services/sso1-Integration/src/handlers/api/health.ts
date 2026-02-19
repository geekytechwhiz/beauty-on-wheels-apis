/**
 * Health Check Handler (Public Endpoint)
 * ────────────────────────────────────────
 * GET /health
 *
 * No authentication required.
 * Used by load balancers, monitoring tools (e.g. CloudWatch Synthetics,
 * Datadog, Pingdom) to verify the service is reachable and operational.
 *
 * Returns:
 *   200 OK  { status: "healthy", timestamp, version, region, stage }
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "../../types";
import { ok } from "../../utils/response";
import { createLogger } from "../../utils/logger";

const logger = createLogger("HealthHandler");

// Read at cold-start to avoid repeated env lookups on warm invocations
const REGION = process.env["REGION"] ?? process.env["AWS_REGION"] ?? "unknown";
const STAGE = process.env["STAGE"] ?? "unknown";
const SERVICE_VERSION = process.env["npm_package_version"] ?? "1.0.0";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(event.requestContext?.requestId ?? "unknown");
  logger.info("Health check handler invoked");

  return ok(
    {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "aws-serverless-sso",
      version: SERVICE_VERSION,
      region: REGION,
      stage: STAGE,
    },
    "Service is healthy"
  );
};
