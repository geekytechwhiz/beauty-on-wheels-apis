import { BaseError } from '@api-hub/utils';

/**
 * Writable required attributes from bw-user-pool schema (us-east-1_LeQxyLZ3x).
 * `sub` is also required but immutable and assigned by Cognito.
 */
export const REQUIRED_WRITABLE_COGNITO_ATTRIBUTES = [
  'email',
  'phone_number',
  'name',
] as const;

export type RequiredWritableCognitoAttribute =
  (typeof REQUIRED_WRITABLE_COGNITO_ATTRIBUTES)[number];

export type CognitoAttributeDefaults = {
  [K in RequiredWritableCognitoAttribute]?: string;
};

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  appClientId: string;
  /** Present when the app client was created with a secret. Required for SECRET_HASH. */
  appClientSecret?: string;
  issuer: string;
  jwksUri: string;
  defaultAttributes?: CognitoAttributeDefaults;
}

export function cognitoDefaultEnvName(
  attribute: RequiredWritableCognitoAttribute,
): string {
  return `COGNITO_DEFAULT_${attribute.toUpperCase()}`;
}

export function getCognitoAttributeDefaults(): CognitoAttributeDefaults {
  const defaults: CognitoAttributeDefaults = {};
  for (const attribute of REQUIRED_WRITABLE_COGNITO_ATTRIBUTES) {
    const value = process.env[cognitoDefaultEnvName(attribute)]?.trim();
    if (value) {
      defaults[attribute] = value;
    }
  }
  return defaults;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new BaseError(
      `Missing required configuration: ${name}`,
      500,
      'AUTH_CONFIG_MISSING',
    );
  }
  return value;
}

/**
 * Resolves Cognito settings from environment variables.
 * Issuer and JWKS URI are derived when not provided explicitly.
 */
export function getCognitoConfig(): CognitoConfig {
  const region =
    process.env.COGNITO_REGION?.trim() ||
    process.env.REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    'us-east-1';
  const userPoolId = requiredEnv('COGNITO_USER_POOL_ID');
  const appClientId = requiredEnv('COGNITO_APP_CLIENT_ID');
  // App-client secrets are deployment configuration, never source code.  The
  // value is optional because public Cognito clients do not use SECRET_HASH.
  const appClientSecret = process.env.COGNITO_APP_CLIENT_SECRET?.trim() || undefined;
  const issuer =
    process.env.COGNITO_ISSUER?.trim() ||
    `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const jwksUri =
    process.env.COGNITO_JWKS_URI?.trim() ||
    `${issuer}/.well-known/jwks.json`;

  return {
    region,
    userPoolId,
    appClientId,
    appClientSecret,
    issuer,
    jwksUri,
    defaultAttributes: getCognitoAttributeDefaults(),
  };
}

export function getCognitoJwksUrl(
  userPoolId: string,
  region: string,
): string {
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
}
