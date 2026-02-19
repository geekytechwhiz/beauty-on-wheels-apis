// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION: Register HMS Client  (Admin endpoint)
// ROUTE:    POST /admin/hms-clients
// AUTH:     None in template (protect via API Gateway resource policy in prod)
//
// Registers a new HMS organization so it can use the SSO system.
// Returns the generated API key ONCE — it is never retrievable again.
// ─────────────────────────────────────────────────────────────────────────────

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import {
  RegisterHmsClientRequest,
  RegisterHmsClientResponse,
  HmsClientRecord,
} from "../../../types";
import { getItem, putItem, Tables } from "../../../utils/dynamodb";
import { generateApiKey, hashApiKey } from "../../../utils/token";
import { successResponse, Responses } from "../../../utils/response";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("RegisterHmsClient");

const VALID_SCOPES = [
  "read:patient",
  "read:health-records",
  "write:health-records",
  "read:medications",
  "write:medications",
  "read:lab-results",
];

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(context.awsRequestId);
  logger.info("RegisterHmsClient invoked");
  console.log("A1");
  try {
    // ── Parse & validate body ─────────────────────────────────────────────────
    if (!event.body) {
      return Responses.badRequest("Request body is required", context.awsRequestId);
    }

    let body: RegisterHmsClientRequest;
    try {
      body = JSON.parse(event.body) as RegisterHmsClientRequest;
    } catch {
      return Responses.badRequest("Invalid JSON in request body", context.awsRequestId);
    }

    const { clientId, clientName, allowedScopes, allowedRedirectUris } = body;

    if (!clientId || !/^[a-zA-Z0-9-_]+$/.test(clientId)) {
      return Responses.badRequest(
        "clientId is required and must be alphanumeric (hyphens/underscores allowed)",
        context.awsRequestId
      );
    }
    if (!clientName || clientName.trim().length < 3) {
      return Responses.badRequest(
        "clientName is required (min 3 characters)",
        context.awsRequestId
      );
    }
    
    if (!allowedScopes || allowedScopes.length === 0) {
      return Responses.badRequest("allowedScopes must have at least one scope", context.awsRequestId);
    }
    const invalidScopes = allowedScopes.filter((s) => !VALID_SCOPES.includes(s));
    if (invalidScopes.length > 0) {
      return Responses.badRequest(
        `Invalid scopes: ${invalidScopes.join(", ")}. Valid: ${VALID_SCOPES.join(", ")}`,
        context.awsRequestId
      );
    }
    if (!allowedRedirectUris || allowedRedirectUris.length === 0) {
      return Responses.badRequest(
        "allowedRedirectUris must have at least one URI",
        context.awsRequestId
      );
    }
    
    // ── Check if client already exists ────────────────────────────────────────
    const existing = await getItem<HmsClientRecord>(Tables.HMS_CLIENTS, { clientId });
    
    if (existing) {
      return Responses.conflict(
        `HMS client '${clientId}' already exists`,
        context.awsRequestId
      );
    }
    console.log("result 12345");
    // ── Generate API key ──────────────────────────────────────────────────────
    const plainApiKey = generateApiKey(clientId);
    const apiKeyHash = hashApiKey(plainApiKey);
    const now = new Date().toISOString();

    const record: HmsClientRecord = {
      clientId,
      clientName: clientName.trim(),
      apiKeyHash,
      allowedScopes,
      allowedRedirectUris,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    console.log("result 123", record);
    const result = await putItem(Tables.HMS_CLIENTS, record);
    console.log("result", result);

    const response: RegisterHmsClientResponse = {
      clientId,
      clientName: clientName.trim(),
      apiKey: plainApiKey,   // ⚠️  Shown ONCE — store securely in HMS!
      allowedScopes,
    };

    logger.info("HMS client registered", { clientId, clientName, allowedScopes });

    return successResponse(response, 201);
  } catch (error) {
    logger.error("Unexpected error in RegisterHmsClient", error);
    return Responses.internalError(context.awsRequestId);
  }
};
