/* eslint-disable mvrx/no-direct-dynamodb */
import {
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  AdminUserGlobalSignOutCommand,
  AuthFlowType,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InvalidParameterException,
  ListUsersCommand,
  MessageActionType,
  NotAuthorizedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { BaseError, UnauthorizedError } from '@api-hub/utils';
import crypto from 'crypto';

import { getCognitoConfig, type CognitoConfig } from '../config/cognito.config';
import { resolveCognitoCreateUserAttributes } from './cognito-user-attributes';

export interface CognitoIdentity {
  sub: string;
  username: string;
}

export interface CognitoTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  idToken?: string;
}

export interface FindOrCreateCognitoUserInput {
  email?: string;
  phoneNumber?: string;
  name?: string;
}

export interface CognitoAuthClient {
  findOrCreateUser(input: FindOrCreateCognitoUserInput): Promise<CognitoIdentity>;
  issueTokens(username: string): Promise<CognitoTokenSet>;
  refreshTokens(refreshToken: string): Promise<CognitoTokenSet>;
  signOut(username: string): Promise<void>;
}

function randomCognitoPassword(): string {
  const raw = crypto.randomBytes(24).toString('base64url');
  return `Aa1!${raw}`;
}

export function computeCognitoSecretHash(
  username: string,
  clientId: string,
  clientSecret: string,
): string {
  return crypto
    .createHmac('sha256', clientSecret)
    .update(username + clientId)
    .digest('base64');
}

function errorName(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isNotAuthorized(err: unknown): boolean {
  return (
    err instanceof NotAuthorizedException ||
    errorName(err) === 'NotAuthorizedException'
  );
}

function isAuthFlowDisabled(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  const isInvalidParameter =
    err instanceof InvalidParameterException ||
    errorName(err) === 'InvalidParameterException';
  return isInvalidParameter && message.includes('flow not enabled');
}

function asSub(attributes?: { Name?: string; Value?: string }[]): string | undefined {
  const sub = attributes?.find((attr) => attr.Name === 'sub')?.Value;
  return sub?.trim() || undefined;
}

export class CognitoIdentityService implements CognitoAuthClient {
  constructor(
    private readonly client: CognitoIdentityProviderClient = new CognitoIdentityProviderClient(
      {},
    ),
    private readonly config: CognitoConfig = getCognitoConfig(),
  ) {}

  async findOrCreateUser(
    input: FindOrCreateCognitoUserInput,
  ): Promise<CognitoIdentity> {
    const existing = await this.findUser(input);
    if (existing) {
      return existing;
    }
    return this.createUser(input);
  }

  async issueTokens(username: string): Promise<CognitoTokenSet> {
    const password = randomCognitoPassword();
    await this.client.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: this.config.userPoolId,
        Username: username,
        Password: password,
        Permanent: true,
      }),
    );

    const authParameters = this.buildAuthParameters(username, {
      PASSWORD: password,
    });

    try {
      return await this.adminPasswordAuth(authParameters);
    } catch (err) {
      if (isAuthFlowDisabled(err)) {
        try {
          return await this.userPasswordAuth(authParameters);
        } catch (fallbackErr) {
          this.rethrowTokenIssueFailure(fallbackErr);
        }
      }
      this.rethrowTokenIssueFailure(err);
    }
  }

  async refreshTokens(refreshToken: string): Promise<CognitoTokenSet> {
    try {
      const result = await this.client.send(
        new InitiateAuthCommand({
          ClientId: this.config.appClientId,
          AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken,
          },
        }),
      );
      return this.toTokenSet(result.AuthenticationResult, refreshToken);
    } catch (err) {
      if (isNotAuthorized(err)) {
        throw new UnauthorizedError('Invalid refresh token', undefined, {
          metadata: { cognitoMessage: errorMessage(err) },
        });
      }
      throw err;
    }
  }

  async signOut(username: string): Promise<void> {
    try {
      await this.client.send(
        new AdminUserGlobalSignOutCommand({
          UserPoolId: this.config.userPoolId,
          Username: username,
        }),
      );
    } catch (err) {
      if (err instanceof UserNotFoundException) {
        return;
      }
      throw err;
    }
  }

  private async findUser(
    input: FindOrCreateCognitoUserInput,
  ): Promise<CognitoIdentity | null> {
    const filter = input.email
      ? `email = "${input.email.replace(/"/g, '')}"`
      : input.phoneNumber
        ? `phone_number = "${input.phoneNumber.replace(/"/g, '')}"`
        : null;

    if (!filter) {
      throw new BaseError(
        'Email or phone number is required to resolve a Cognito identity',
        400,
        'IDENTITY_DESTINATION_REQUIRED',
      );
    }

    const result = await this.client.send(
      new ListUsersCommand({
        UserPoolId: this.config.userPoolId,
        Filter: filter,
        Limit: 1,
      }),
    );

    const user = result.Users?.[0];
    const username = user?.Username;
    const sub = asSub(user?.Attributes);
    if (!username || !sub) {
      return null;
    }
    return { username, sub };
  }

  private async createUser(
    input: FindOrCreateCognitoUserInput,
  ): Promise<CognitoIdentity> {
    const username = `bow_${crypto.randomUUID().replace(/-/g, '')}`;
    const userAttributes = resolveCognitoCreateUserAttributes(
      input,
      this.config.defaultAttributes ?? {},
      username,
    );

    const created = await this.client.send(
      new AdminCreateUserCommand({
        UserPoolId: this.config.userPoolId,
        Username: username,
        UserAttributes: userAttributes,
        MessageAction: MessageActionType.SUPPRESS,
      }),
    );

    const sub = asSub(created.User?.Attributes);
    const createdUsername = created.User?.Username ?? username;
    if (!sub) {
      throw new BaseError(
        'Cognito user was created without a sub',
        500,
        'COGNITO_IDENTITY_MISSING',
      );
    }

    return { username: createdUsername, sub };
  }

  private buildAuthParameters(
    username: string,
    extra: Record<string, string>,
  ): Record<string, string> {
    const parameters: Record<string, string> = {
      USERNAME: username,
      ...extra,
    };
    const secret = this.config.appClientSecret;
    if (secret) {
      parameters.SECRET_HASH = computeCognitoSecretHash(
        username,
        this.config.appClientId,
        secret,
      );
    }
    return parameters;
  }

  private async adminPasswordAuth(
    authParameters: Record<string, string>,
  ): Promise<CognitoTokenSet> {
    const result = await this.client.send(
      new AdminInitiateAuthCommand({
        UserPoolId: this.config.userPoolId,
        ClientId: this.config.appClientId,
        AuthFlow: AuthFlowType.ADMIN_USER_PASSWORD_AUTH,
        AuthParameters: authParameters,
      }),
    );
    return this.toTokenSet(result.AuthenticationResult);
  }

  private async userPasswordAuth(
    authParameters: Record<string, string>,
  ): Promise<CognitoTokenSet> {
    const result = await this.client.send(
      new InitiateAuthCommand({
        ClientId: this.config.appClientId,
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        AuthParameters: authParameters,
      }),
    );
    return this.toTokenSet(result.AuthenticationResult);
  }

  private rethrowTokenIssueFailure(err: unknown): never {
    const cognitoMessage = errorMessage(err);
    const lower = cognitoMessage.toLowerCase();

    if (lower.includes('secret hash')) {
      throw new BaseError(
        'Cognito app client requires SECRET_HASH. Set COGNITO_APP_CLIENT_SECRET to the app client secret.',
        500,
        'COGNITO_CLIENT_SECRET_REQUIRED',
        undefined,
        { metadata: { cognitoMessage } },
      );
    }

    if (isAuthFlowDisabled(err) || lower.includes('flow not enabled')) {
      throw new BaseError(
        'Cognito app client does not allow password auth. Enable ALLOW_ADMIN_USER_PASSWORD_AUTH or ALLOW_USER_PASSWORD_AUTH.',
        500,
        'COGNITO_AUTH_FLOW_DISABLED',
        undefined,
        { metadata: { cognitoMessage } },
      );
    }

    if (isNotAuthorized(err)) {
      throw new UnauthorizedError('Invalid credentials', undefined, {
        metadata: { cognitoMessage },
      });
    }

    throw err;
  }

  private toTokenSet(
    result:
      | {
          AccessToken?: string;
          RefreshToken?: string;
          ExpiresIn?: number;
          TokenType?: string;
          IdToken?: string;
        }
      | undefined,
    fallbackRefreshToken?: string,
  ): CognitoTokenSet {
    const accessToken = result?.AccessToken;
    const refreshToken = result?.RefreshToken || fallbackRefreshToken;
    if (!accessToken || !refreshToken) {
      throw new BaseError(
        'Cognito did not return authentication tokens',
        502,
        'COGNITO_TOKEN_MISSING',
      );
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: result?.ExpiresIn ?? 3600,
      tokenType: result?.TokenType || 'Bearer',
      idToken: result?.IdToken,
    };
  }
}

let defaultClient: CognitoAuthClient | undefined;

export function getCognitoAuthClient(): CognitoAuthClient {
  if (!defaultClient) {
    defaultClient = new CognitoIdentityService();
  }
  return defaultClient;
}

export function setCognitoAuthClientForTests(
  client: CognitoAuthClient | undefined,
): void {
  defaultClient = client;
}
