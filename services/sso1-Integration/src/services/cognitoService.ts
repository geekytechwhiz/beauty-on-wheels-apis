/**
 * CognitoService
 * ──────────────
 * Encapsulates all interactions with Amazon Cognito:
 *   • Exchanging an OAuth2 authorization code for tokens
 *   • Refreshing an access token with a refresh token
 *   • Fetching the Cognito /oauth2/userInfo endpoint
 *   • Revoking a token (global sign-out)
 *
 * Token-endpoint calls are made with the native `fetch` API (Node.js 20+).
 * Admin operations use the AWS SDK v3 Cognito Identity Provider client.
 */

import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminUserGlobalSignOutCommand,
  GetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type {
  AuthTokens,
  CognitoConfig,
  CognitoTokenResponse,
  UserProfile,
} from "../types";
import { createLogger } from "../utils/logger";

const logger = createLogger("CognitoService");

// ─── Resolve Cognito config from environment variables ────────────────────────
export function getCognitoConfig(): CognitoConfig {
  const userPoolId = process.env["COGNITO_USER_POOL_ID"];
  const clientId = process.env["COGNITO_CLIENT_ID"];
  const domain = process.env["COGNITO_DOMAIN"];
  const region = process.env["REGION"] ?? process.env["AWS_REGION"] ?? "us-east-1";
  const callbackUrl = process.env["CALLBACK_URL"];
  const logoutRedirectUrl = process.env["LOGOUT_REDIRECT_URL"] ?? "/";

  if (!userPoolId || !clientId || !domain || !callbackUrl) {
    throw new Error(
      "Missing required Cognito environment variables: " +
        "COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_DOMAIN, CALLBACK_URL"
    );
  }

  return { userPoolId, clientId, domain, region, callbackUrl, logoutRedirectUrl };
}

// ─── Lazy singleton SDK client ────────────────────────────────────────────────
let _client: CognitoIdentityProviderClient | null = null;

function getClient(region: string): CognitoIdentityProviderClient {
  if (!_client) {
    _client = new CognitoIdentityProviderClient({ region });
  }
  return _client;
}

// ─── Build the base Cognito Hosted-UI URL ─────────────────────────────────────
function tokenEndpoint(domain: string, region: string): string {
  return `https://${domain}.auth.${region}.amazoncognito.com/oauth2/token`;
}

function hostedUiBaseUrl(domain: string, region: string): string {
  return `https://${domain}.auth.${region}.amazoncognito.com`;
}

// ─── Exchange authorization code for tokens ───────────────────────────────────
export async function exchangeCodeForTokens(
  code: string,
  config: CognitoConfig
): Promise<AuthTokens> {
  logger.info("Exchanging authorization code for tokens");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: config.callbackUrl,
  });

  const response = await fetch(tokenEndpoint(config.domain, config.region), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await response.json()) as CognitoTokenResponse;

  if (!response.ok || data.error) {
    logger.error("Token exchange failed", undefined, {
      status: response.status,
      error: data.error,
      description: data.error_description,
    });
    throw new Error(
      `Token exchange failed: ${data.error ?? response.statusText} — ${data.error_description ?? ""}`
    );
  }

  logger.info("Token exchange successful");

  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  };
}

// ─── Refresh an access token using a refresh token ───────────────────────────
export async function refreshAccessToken(
  refreshToken: string,
  config: CognitoConfig
): Promise<Omit<AuthTokens, "refreshToken">> {
  logger.info("Refreshing access token");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });

  const response = await fetch(tokenEndpoint(config.domain, config.region), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await response.json()) as CognitoTokenResponse;

  if (!response.ok || data.error) {
    logger.error("Token refresh failed", undefined, {
      status: response.status,
      error: data.error,
    });
    throw new Error(
      `Token refresh failed: ${data.error ?? response.statusText}`
    );
  }

  logger.info("Access token refreshed successfully");

  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  };
}

// ─── Get user info from the Cognito /oauth2/userInfo endpoint ─────────────────
export async function getUserInfo(
  accessToken: string,
  config: CognitoConfig
): Promise<Record<string, unknown>> {
  logger.info("Fetching user info from Cognito userInfo endpoint");

  const url = `${hostedUiBaseUrl(config.domain, config.region)}/oauth2/userInfo`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.statusText}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

// ─── Get user attributes from the User Pool (admin SDK) ──────────────────────
export async function getUserFromPool(
  username: string,
  config: CognitoConfig
): Promise<UserProfile> {
  logger.info("Fetching user attributes from Cognito User Pool", { username });

  const client = getClient(config.region);
  const command = new AdminGetUserCommand({
    UserPoolId: config.userPoolId,
    Username: username,
  });

  const response = await client.send(command);
  const attrs = response.UserAttributes ?? [];

  const get = (name: string): string | undefined =>
    attrs.find((a) => a.Name === name)?.Value;

  return {
    userId: get("sub") ?? username,
    email: get("email") ?? "",
    emailVerified: get("email_verified") === "true",
    name: get("name"),
    givenName: get("given_name"),
    familyName: get("family_name"),
    username: response.Username,
    groups: [],
  };
}

// ─── Get user info using the access token (non-admin) ─────────────────────────
export async function getUserBySdkToken(
  accessToken: string,
  config: CognitoConfig
): Promise<UserProfile> {
  logger.info("Fetching user via SDK GetUser");

  const client = getClient(config.region);
  const command = new GetUserCommand({ AccessToken: accessToken });
  const response = await client.send(command);

  const attrs = response.UserAttributes ?? [];
  const get = (name: string): string | undefined =>
    attrs.find((a) => a.Name === name)?.Value;

  return {
    userId: get("sub") ?? response.Username ?? "",
    email: get("email") ?? "",
    emailVerified: get("email_verified") === "true",
    name: get("name"),
    givenName: get("given_name"),
    familyName: get("family_name"),
    username: response.Username,
    groups: [],
  };
}

// ─── Global sign-out (invalidates all tokens for the user) ───────────────────
export async function globalSignOut(
  username: string,
  config: CognitoConfig
): Promise<void> {
  logger.info("Performing global sign-out for user", { username });

  const client = getClient(config.region);
  const command = new AdminUserGlobalSignOutCommand({
    UserPoolId: config.userPoolId,
    Username: username,
  });

  await client.send(command);
  logger.info("Global sign-out successful", { username });
}

// ─── Build the Cognito Hosted UI login URL ────────────────────────────────────
export function buildLoginUrl(config: CognitoConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: "email openid profile",
    redirect_uri: config.callbackUrl,
  });

  return `${hostedUiBaseUrl(config.domain, config.region)}/login?${params.toString()}`;
}

// ─── Build the Cognito Hosted UI logout URL ───────────────────────────────────
export function buildLogoutUrl(config: CognitoConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: config.logoutRedirectUrl,
  });

  return `${hostedUiBaseUrl(config.domain, config.region)}/logout?${params.toString()}`;
}
