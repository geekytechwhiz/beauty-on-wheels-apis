import {
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InvalidParameterException,
  ListUsersCommand,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { UnauthorizedError } from '@api-hub/utils';

import {
  CognitoIdentityService,
  computeCognitoSecretHash,
} from './cognito-identity.provider';
import type { CognitoConfig } from '../config/cognito.config';

const ddbMock = mockClient(CognitoIdentityProviderClient);

const config: CognitoConfig = {
  region: 'us-east-1',
  userPoolId: 'us-east-1_testpool',
  appClientId: 'test-client',
  issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool',
  jwksUri: 'https://example.test/jwks.json',
  defaultAttributes: {
    email: 'dev+{username}@beautyonwheels.test',
    phone_number: '+1{digits}',
    name: 'Beauty On Wheels User',
  },
};

describe('CognitoIdentityService', () => {
  const service = new CognitoIdentityService(
    new CognitoIdentityProviderClient({}),
    config,
  );

  beforeEach(() => {
    ddbMock.reset();
  });

  it('returns an existing Cognito user instead of creating a duplicate', async () => {
    ddbMock.on(ListUsersCommand).resolves({
      Users: [
        {
          Username: 'existing-user',
          Attributes: [{ Name: 'sub', Value: 'sub-existing' }],
        },
      ],
    });

    const identity = await service.findOrCreateUser({
      phoneNumber: '+15551234567',
    });

    expect(identity).toEqual({ username: 'existing-user', sub: 'sub-existing' });
    expect(ddbMock.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });

  it('creates a Cognito user when none exists', async () => {
    ddbMock.on(ListUsersCommand).resolves({ Users: [] });
    ddbMock.on(AdminCreateUserCommand).resolves({
      User: {
        Username: 'bow_abc',
        Attributes: [{ Name: 'sub', Value: 'sub-new' }],
      },
    });

    const identity = await service.findOrCreateUser({ email: 'a@b.com' });
    expect(identity.sub).toBe('sub-new');
    expect(identity.username).toBe('bow_abc');
    expect(ddbMock.commandCalls(AdminCreateUserCommand)).toHaveLength(1);

    const created = ddbMock.commandCalls(AdminCreateUserCommand)[0].args[0]
      .input;
    const attributes = Object.fromEntries(
      (created.UserAttributes ?? []).map((attr) => [attr.Name, attr.Value]),
    );
    expect(attributes.email).toBe('a@b.com');
    expect(attributes.email_verified).toBe('true');
    expect(attributes.phone_number).toMatch(/^\+1\d{10}$/);
    expect(attributes.phone_number_verified).toBeUndefined();
    expect(attributes.name).toBe('Beauty On Wheels User');
    expect(created.Username).toMatch(/^bow_/);
  });

  it('creates a Cognito user from phone-only input using email and name defaults', async () => {
    ddbMock.on(ListUsersCommand).resolves({ Users: [] });
    ddbMock.on(AdminCreateUserCommand).resolves({
      User: {
        Username: 'bow_phone',
        Attributes: [{ Name: 'sub', Value: 'sub-phone' }],
      },
    });

    const identity = await service.findOrCreateUser({
      phoneNumber: '+15551234567',
    });
    expect(identity).toEqual({ username: 'bow_phone', sub: 'sub-phone' });

    const attributes = Object.fromEntries(
      (
        ddbMock.commandCalls(AdminCreateUserCommand)[0].args[0].input
          .UserAttributes ?? []
      ).map((attr) => [attr.Name, attr.Value]),
    );
    expect(attributes.phone_number).toBe('+15551234567');
    expect(attributes.phone_number_verified).toBe('true');
    expect(attributes.email).toMatch(/^dev\+bow_[a-z0-9]+@beautyonwheels\.test$/);
    expect(attributes.email_verified).toBeUndefined();
    expect(attributes.name).toBe('Beauty On Wheels User');
  });

  it('does not overwrite provided Cognito attributes with defaults', async () => {
    ddbMock.on(ListUsersCommand).resolves({ Users: [] });
    ddbMock.on(AdminCreateUserCommand).resolves({
      User: {
        Username: 'bow_provided',
        Attributes: [{ Name: 'sub', Value: 'sub-provided' }],
      },
    });

    const identity = await service.findOrCreateUser({
      email: 'ada@example.com',
      phoneNumber: '+15559876543',
      name: 'Ada Lovelace',
    });

    expect(identity).toEqual({
      username: 'bow_provided',
      sub: 'sub-provided',
    });

    const attributes = Object.fromEntries(
      (
        ddbMock.commandCalls(AdminCreateUserCommand)[0].args[0].input
          .UserAttributes ?? []
      ).map((attr) => [attr.Name, attr.Value]),
    );
    expect(attributes.email).toBe('ada@example.com');
    expect(attributes.phone_number).toBe('+15559876543');
    expect(attributes.name).toBe('Ada Lovelace');
  });

  it('issues Cognito tokens without exposing the generated password', async () => {
    ddbMock.on(AdminSetUserPasswordCommand).resolves({});
    ddbMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'access',
        RefreshToken: 'refresh',
        ExpiresIn: 3600,
        TokenType: 'Bearer',
      },
    });

    const tokens = await service.issueTokens('existing-user');
    expect(tokens.accessToken).toBe('access');
    expect(tokens.refreshToken).toBe('refresh');
    expect(tokens.tokenType).toBe('Bearer');
    const authParams =
      ddbMock.commandCalls(AdminInitiateAuthCommand)[0].args[0].input
        .AuthParameters;
    expect(authParams?.SECRET_HASH).toBeUndefined();
  });

  it('sends SECRET_HASH when the app client has a secret', async () => {
    const secret = 'app-client-secret';
    const confidential = new CognitoIdentityService(
      new CognitoIdentityProviderClient({}),
      { ...config, appClientSecret: secret },
    );
    ddbMock.on(AdminSetUserPasswordCommand).resolves({});
    ddbMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'access',
        RefreshToken: 'refresh',
        ExpiresIn: 3600,
        TokenType: 'Bearer',
      },
    });

    await confidential.issueTokens('existing-user');
    const authParams =
      ddbMock.commandCalls(AdminInitiateAuthCommand)[0].args[0].input
        .AuthParameters;
    expect(authParams?.SECRET_HASH).toBe(
      computeCognitoSecretHash('existing-user', config.appClientId, secret),
    );
  });

  it('maps missing SECRET_HASH failures to a configuration error', async () => {
    ddbMock.on(AdminSetUserPasswordCommand).resolves({});
    ddbMock.on(AdminInitiateAuthCommand).rejects(
      new NotAuthorizedException({
        message: 'Unable to verify secret hash for client test-client',
        $metadata: {},
      }),
    );

    await expect(service.issueTokens('existing-user')).rejects.toMatchObject({
      code: 'COGNITO_CLIENT_SECRET_REQUIRED',
      statusCode: 500,
    });
  });

  it('falls back to USER_PASSWORD_AUTH when admin password auth is disabled', async () => {
    ddbMock.on(AdminSetUserPasswordCommand).resolves({});
    ddbMock.on(AdminInitiateAuthCommand).rejects(
      new InvalidParameterException({
        message: 'Auth flow not enabled for this client',
        $metadata: {},
      }),
    );
    ddbMock.on(InitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'access',
        RefreshToken: 'refresh',
        ExpiresIn: 3600,
        TokenType: 'Bearer',
      },
    });

    const tokens = await service.issueTokens('existing-user');
    expect(tokens.accessToken).toBe('access');
    expect(ddbMock.commandCalls(InitiateAuthCommand)).toHaveLength(1);
  });

  it('keeps Invalid credentials when Cognito rejects the password', async () => {
    ddbMock.on(AdminSetUserPasswordCommand).resolves({});
    ddbMock.on(AdminInitiateAuthCommand).rejects(
      new NotAuthorizedException({
        message: 'Incorrect username or password.',
        $metadata: {},
      }),
    );

    await expect(service.issueTokens('existing-user')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('refreshes Cognito tokens', async () => {
    ddbMock.on(InitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'new-access',
        ExpiresIn: 3600,
        TokenType: 'Bearer',
      },
    });

    const tokens = await service.refreshTokens('refresh');
    expect(tokens.accessToken).toBe('new-access');
    expect(tokens.refreshToken).toBe('refresh');
  });
});
