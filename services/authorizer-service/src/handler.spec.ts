import type { APIGatewayTokenAuthorizerEvent } from 'aws-lambda';
import { main } from './handler';

import * as auth from '@api-hub/auth';
import * as legacy from './legacy';
import * as jwt from 'jsonwebtoken';

jest.mock('@api-hub/auth', () => {
  const actual = jest.requireActual('@api-hub/auth');
  return {
    ...actual,
    validateAccessToken: jest.fn(),
  };
});

jest.mock('./legacy', () => ({
  getLegacySecrets: jest.fn(),
  getUserDetails: jest.fn(),
  isLegacySessionValid: jest.fn(),
  sendOtpFireAndForget: jest.fn(),
  generateRandomIdWithTimestamp: jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  decode: jest.fn(),
}));

const methodArn =
  'arn:aws:execute-api:us-east-1:123456789012:apiId/stg/GET/resource';

function makeEvent(
  authorizationToken?: string
): APIGatewayTokenAuthorizerEvent {
  return {
    type: 'TOKEN',
    authorizationToken,
    methodArn,
  } as unknown as APIGatewayTokenAuthorizerEvent;
}

describe('authorizer-service handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...originalEnv };

    (legacy.generateRandomIdWithTimestamp as jest.Mock).mockReturnValue(
      'RID-123'
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('denies when Authorization header is missing', async () => {
    const res = await main(makeEvent(undefined));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('denies when Authorization is empty string', async () => {
    const res = await main(makeEvent(''));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('denies when Authorization is not Bearer', async () => {
    const res = await main(makeEvent('Token abc'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('denies when Bearer prefix has no token (only spaces)', async () => {
    const res = await main(makeEvent('Bearer   '));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('denies when user pool cannot be resolved (no env or secrets)', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.SECRET_MANAGER_NAME;
    delete process.env.USER_TABLE;

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('denies when resolveUserPoolId throws (secrets missing USER_POOL_ID)', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    process.env.SECRET_MANAGER_NAME = 'SECRET_NAME';
    process.env.USER_TABLE = 'user-table';

    (legacy.getLegacySecrets as jest.Mock).mockResolvedValue({});

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('denies when resolveUserPoolId throws non-Error', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    process.env.SECRET_MANAGER_NAME = 'SECRET_NAME';
    process.env.USER_TABLE = 'user-table';
    (legacy.getLegacySecrets as jest.Mock).mockRejectedValue('string error');

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('allows for valid token (new flow)', async () => {
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pool';
    process.env.EXPECTED_AUDIENCE = 'aud';
    delete process.env.SECRET_MANAGER_NAME;
    delete process.env.USER_TABLE;

    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-1',
      clientId: 'client-1',
      scopes: ['patient/*.read', 'launch/patient'],
      tenantId: 'tenant-1',
    });

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(res.principalId).toBe('sub-1');
    expect(res.context).toMatchObject({
      sub: 'sub-1',
      clientId: 'client-1',
      tenantId: 'tenant-1',
    });
    expect(res.context?.scopes).toBe(
      JSON.stringify(['patient/*.read', 'launch/patient'])
    );
  });

  it('calls validateAccessToken with COGNITO_CLIENT_ID when EXPECTED_AUDIENCE unset', async () => {
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pool';
    delete process.env.EXPECTED_AUDIENCE;
    process.env.COGNITO_CLIENT_ID = 'my-client-id';
    delete process.env.SECRET_MANAGER_NAME;
    delete process.env.USER_TABLE;

    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-1',
      clientId: 'client-1',
      scopes: [],
      tenantId: 't1',
    });

    await main(makeEvent('Bearer abc.def.ghi'));
    expect(auth.validateAccessToken).toHaveBeenCalledWith(
      'abc.def.ghi',
      expect.objectContaining({ expectedAudience: ['my-client-id'] })
    );
  });

  it('parses comma-separated EXPECTED_AUDIENCE', async () => {
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pool';
    process.env.EXPECTED_AUDIENCE = ' aud1 , aud2 , aud3 ';
    delete process.env.SECRET_MANAGER_NAME;
    delete process.env.USER_TABLE;

    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-1',
      clientId: 'c1',
      scopes: [],
      tenantId: 't1',
    });

    await main(makeEvent('Bearer abc.def.ghi'));
    expect(auth.validateAccessToken).toHaveBeenCalledWith(
      'abc.def.ghi',
      expect.objectContaining({
        expectedAudience: ['aud1', 'aud2', 'aud3'],
      })
    );
  });

  it('uses pool from env when both COGNITO_USER_POOL_ID and legacy env set', async () => {
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_fromEnv';
    process.env.SECRET_MANAGER_NAME = 'SECRET_NAME';
    process.env.USER_TABLE = 'user-table';
    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-1',
      clientId: 'c1',
      scopes: [],
      tenantId: 't1',
    });

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(legacy.getLegacySecrets).not.toHaveBeenCalled();
  });

  it('uses REGION from env when set', async () => {
    process.env.REGION = 'eu-west-1';
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pool';
    delete process.env.SECRET_MANAGER_NAME;
    delete process.env.USER_TABLE;
    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-1',
      clientId: 'c1',
      scopes: [],
      tenantId: 't1',
    });

    await main(makeEvent('Bearer abc.def.ghi'));
    expect(auth.validateAccessToken).toHaveBeenCalledWith(
      'abc.def.ghi',
      expect.objectContaining({ region: 'eu-west-1' })
    );
  });

  it('uses AWS_REGION when REGION not set', async () => {
    delete process.env.REGION;
    process.env.AWS_REGION = 'ap-southeast-1';
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pool';
    delete process.env.SECRET_MANAGER_NAME;
    delete process.env.USER_TABLE;
    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-1',
      clientId: 'c1',
      scopes: [],
      tenantId: 't1',
    });

    await main(makeEvent('Bearer abc.def.ghi'));
    expect(auth.validateAccessToken).toHaveBeenCalledWith(
      'abc.def.ghi',
      expect.objectContaining({ region: 'ap-southeast-1' })
    );
  });

  it('denies when token validation throws TokenValidationError', async () => {
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pool';

    (auth.validateAccessToken as jest.Mock).mockImplementation(() => {
      throw new auth.TokenValidationError('bad', 'INVALID_TOKEN');
    });

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('denies when token validation throws generic Error', async () => {
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pool';
    (auth.validateAccessToken as jest.Mock).mockRejectedValue(new Error('network error'));

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('allows with SMART context (patient, fhirUser, encounter)', async () => {
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pool';
    delete process.env.SECRET_MANAGER_NAME;
    delete process.env.USER_TABLE;

    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-smart',
      clientId: 'client-smart',
      scopes: ['patient/*.read'],
      tenantId: 't1',
      patient: 'Patient/123',
      fhirUser: 'Practitioner/456',
      encounter: 'Encounter/789',
    });

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(res.context).toMatchObject({
      sub: 'sub-smart',
      patient: 'Patient/123',
      fhirUser: 'Practitioner/456',
      encounter: 'Encounter/789',
    });
  });

  it('allows for valid token (legacy flow) and injects legacy context + sends OTP', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    process.env.SECRET_MANAGER_NAME = 'SECRET_NAME';
    process.env.USER_TABLE = 'user-table-stg';
    process.env.END_USER_MESSAGING_URL = 'https://messaging.example/stg';

    (legacy.getLegacySecrets as jest.Mock).mockResolvedValue({
      USER_POOL_ID: 'us-east-1_legacyPool',
    });

    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-legacy',
      clientId: 'client-legacy',
      scopes: ['scope1'],
      tenantId: 'tenant-legacy',
      userID: 'user-1',
      organizationID: 'org-1',
      authTime: 1234,
    });

    (legacy.getUserDetails as jest.Mock).mockResolvedValue({
      userID: 'user-1',
      organizationID: 'org-1',
      emailAddress: 'a@b.com',
      phoneNumber: '9999999999',
      userType: 'USER',
      defaultProfile: 'DEFAULT',
      lastUsedAccount: 10,
      logoutAt: 0,
      tokenUpdatedAt: 0,
    });

    (legacy.isLegacySessionValid as jest.Mock).mockReturnValue(true);

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(res.principalId).toBe('USER');
    expect(res.context).toMatchObject({
      sub: 'sub-legacy',
      clientId: 'client-legacy',
      tenantId: 'tenant-legacy',
      email: 'a@b.com',
      phoneNumber: '9999999999',
      userID: 'user-1',
      organizationID: 'org-1',
      userType: 'USER',
      defaultProfile: 'DEFAULT',
      randomId: 'RID-123',
    });
    expect(legacy.sendOtpFireAndForget).toHaveBeenCalledWith(
      'https://messaging.example/stg',
      '9999999999'
    );
  });

  it('denies when legacy session is invalid', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    process.env.SECRET_MANAGER_NAME = 'SECRET_NAME';
    process.env.USER_TABLE = 'user-table-stg';

    (legacy.getLegacySecrets as jest.Mock).mockResolvedValue({
      USER_POOL_ID: 'us-east-1_legacyPool',
    });
    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-legacy',
      clientId: 'client-legacy',
      scopes: ['scope1'],
      tenantId: 'tenant-legacy',
      userID: 'user-1',
      organizationID: 'org-1',
      authTime: 1234,
    });
    (legacy.getUserDetails as jest.Mock).mockResolvedValue({
      userID: 'user-1',
      organizationID: 'org-1',
      phoneNumber: '9999999999',
      lastUsedAccount: 0,
      logoutAt: 10,
    });
    (legacy.isLegacySessionValid as jest.Mock).mockReturnValue(false);

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('denies when getUserDetails returns null (legacy session invalid)', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    process.env.SECRET_MANAGER_NAME = 'SECRET_NAME';
    process.env.USER_TABLE = 'user-table-stg';

    (legacy.getLegacySecrets as jest.Mock).mockResolvedValue({
      USER_POOL_ID: 'us-east-1_legacyPool',
    });
    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-legacy',
      clientId: 'client-legacy',
      scopes: ['scope1'],
      tenantId: 'tenant-legacy',
      userID: 'user-1',
      organizationID: 'org-1',
      authTime: 1234,
    });
    (legacy.getUserDetails as jest.Mock).mockResolvedValue(null);

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('allows when legacy env set but ctx has no userID (skips legacy block)', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    process.env.SECRET_MANAGER_NAME = 'SECRET_NAME';
    process.env.USER_TABLE = 'user-table-stg';

    (legacy.getLegacySecrets as jest.Mock).mockResolvedValue({
      USER_POOL_ID: 'us-east-1_legacyPool',
    });
    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-new',
      clientId: 'c1',
      scopes: [],
      tenantId: 't1',
      userID: undefined,
      organizationID: 'org-1',
    });

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(res.principalId).toBe('sub-new');
    expect(res.context?.email).toBeUndefined();
    expect(legacy.getUserDetails).not.toHaveBeenCalled();
  });

  it('allows when legacy env set but ctx has no organizationID (skips legacy block)', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    process.env.SECRET_MANAGER_NAME = 'SECRET_NAME';
    process.env.USER_TABLE = 'user-table-stg';

    (legacy.getLegacySecrets as jest.Mock).mockResolvedValue({
      USER_POOL_ID: 'us-east-1_legacyPool',
    });
    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-new',
      clientId: 'c1',
      scopes: [],
      tenantId: 't1',
      userID: 'user-1',
      organizationID: '',
    });

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(res.principalId).toBe('sub-new');
    expect(legacy.getUserDetails).not.toHaveBeenCalled();
  });

  it('legacy: sends OTP from token phone_number when userDetails.phoneNumber empty', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    process.env.SECRET_MANAGER_NAME = 'SECRET_NAME';
    process.env.USER_TABLE = 'user-table-stg';
    process.env.END_USER_MESSAGING_URL = 'https://msg.example/';

    (legacy.getLegacySecrets as jest.Mock).mockResolvedValue({
      USER_POOL_ID: 'us-east-1_legacyPool',
    });
    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-legacy',
      clientId: 'c1',
      scopes: [],
      tenantId: 't1',
      userID: 'user-1',
      organizationID: 'org-1',
      authTime: 1234,
    });
    (legacy.getUserDetails as jest.Mock).mockResolvedValue({
      userID: 'user-1',
      organizationID: 'org-1',
      emailAddress: 'a@b.com',
      phoneNumber: '',
      userType: 'USER',
      defaultProfile: 'DEFAULT',
      lastUsedAccount: 10,
      logoutAt: 0,
      tokenUpdatedAt: 0,
    });
    (legacy.isLegacySessionValid as jest.Mock).mockReturnValue(true);
    (jwt.decode as jest.Mock).mockReturnValue({ phone_number: ' 5551234567 ' });

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(legacy.sendOtpFireAndForget).toHaveBeenCalledWith(
      'https://msg.example/',
      '5551234567'
    );
  });

  it('legacy: no OTP when userDetails and token have no phone', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    process.env.SECRET_MANAGER_NAME = 'SECRET_NAME';
    process.env.USER_TABLE = 'user-table-stg';
    process.env.END_USER_MESSAGING_URL = 'https://msg.example/';

    (legacy.getLegacySecrets as jest.Mock).mockResolvedValue({
      USER_POOL_ID: 'us-east-1_legacyPool',
    });
    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-legacy',
      clientId: 'c1',
      scopes: [],
      tenantId: 't1',
      userID: 'user-1',
      organizationID: 'org-1',
      authTime: 1234,
    });
    (legacy.getUserDetails as jest.Mock).mockResolvedValue({
      userID: 'user-1',
      organizationID: 'org-1',
      emailAddress: 'a@b.com',
      phoneNumber: '',
      lastUsedAccount: 10,
      logoutAt: 0,
      tokenUpdatedAt: 0,
    });
    (legacy.isLegacySessionValid as jest.Mock).mockReturnValue(true);
    (jwt.decode as jest.Mock).mockReturnValue({});

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(legacy.sendOtpFireAndForget).not.toHaveBeenCalled();
  });

  it('legacy: ignores jwt.decode throw when falling back to token phone', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    process.env.SECRET_MANAGER_NAME = 'SECRET_NAME';
    process.env.USER_TABLE = 'user-table-stg';
    process.env.END_USER_MESSAGING_URL = 'https://msg.example/';

    (legacy.getLegacySecrets as jest.Mock).mockResolvedValue({
      USER_POOL_ID: 'us-east-1_legacyPool',
    });
    (auth.validateAccessToken as jest.Mock).mockResolvedValue({
      sub: 'sub-legacy',
      clientId: 'c1',
      scopes: [],
      tenantId: 't1',
      userID: 'user-1',
      organizationID: 'org-1',
      authTime: 1234,
    });
    (legacy.getUserDetails as jest.Mock).mockResolvedValue({
      userID: 'user-1',
      organizationID: 'org-1',
      phoneNumber: '',
      lastUsedAccount: 10,
      logoutAt: 0,
      tokenUpdatedAt: 0,
    });
    (legacy.isLegacySessionValid as jest.Mock).mockReturnValue(true);
    (jwt.decode as jest.Mock).mockImplementation(() => {
      throw new Error('malformed');
    });

    const res = await main(makeEvent('Bearer abc.def.ghi'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(legacy.sendOtpFireAndForget).not.toHaveBeenCalled();
  });
});

