/**
 * Shared TypeScript type definitions for the AWS Serverless SSO project.
 */

import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  APIGatewayTokenAuthorizerEvent,
  APIGatewayAuthorizerResult,
} from "aws-lambda";

// ─── Re-exports for convenience ───────────────────────────────────────────────
export type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  APIGatewayTokenAuthorizerEvent,
  APIGatewayAuthorizerResult,
};

// ─── Auth Token Set returned after a successful login ─────────────────────────
export interface AuthTokens {
  /** JWT ID token — contains user identity claims */
  idToken: string;
  /** JWT Access token — used to authorise API calls */
  accessToken: string;
  /** Opaque refresh token — used to obtain new access tokens */
  refreshToken: string;
  /** Seconds until the access/ID tokens expire */
  expiresIn: number;
  /** Always "Bearer" */
  tokenType: string;
}

// ─── Raw response shape from the Cognito /oauth2/token endpoint ───────────────
export interface CognitoTokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  error?: string;
  error_description?: string;
}

// ─── Decoded Cognito JWT payload (common claims) ──────────────────────────────
export interface CognitoJwtPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  "cognito:username"?: string;
  "cognito:groups"?: string[];
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
  token_use: "id" | "access";
  scope?: string;
  [key: string]: unknown;
}

// ─── Normalised user profile returned to the client ───────────────────────────
export interface UserProfile {
  userId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
  username?: string;
  groups: string[];
}

// ─── Standard API envelope ────────────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  statusCode: number;
}

// ─── Cognito environment config (resolved from process.env) ───────────────────
export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  domain: string;
  region: string;
  callbackUrl: string;
  logoutRedirectUrl: string;
}

// ─── Lambda handler type aliases ──────────────────────────────────────────────
export type ProxyHandler = (
  event: APIGatewayProxyEvent
) => Promise<APIGatewayProxyResult>;

export type AuthorizerHandler = (
  event: APIGatewayTokenAuthorizerEvent
) => Promise<APIGatewayAuthorizerResult>;

// ─── IAM Policy document used by the custom Lambda authorizer ─────────────────
export interface IamPolicyDocument {
  Version: string;
  Statement: IamStatement[];
}

export interface IamStatement {
  Action: string;
  Effect: "Allow" | "Deny";
  Resource: string;
}

// ─── Token refresh request body ───────────────────────────────────────────────
export interface RefreshTokenBody {
  refreshToken: string;
}
