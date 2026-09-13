import {
  cognitoDefaultEnvName,
  getCognitoAttributeDefaults,
  getCognitoConfig,
  REQUIRED_WRITABLE_COGNITO_ATTRIBUTES,
} from './cognito.config';

describe('cognito config defaults', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('maps required schema attributes to COGNITO_DEFAULT_* env names', () => {
    expect(REQUIRED_WRITABLE_COGNITO_ATTRIBUTES).toEqual([
      'email',
      'phone_number',
      'name',
    ]);
    expect(cognitoDefaultEnvName('email')).toBe('COGNITO_DEFAULT_EMAIL');
    expect(cognitoDefaultEnvName('phone_number')).toBe(
      'COGNITO_DEFAULT_PHONE_NUMBER',
    );
    expect(cognitoDefaultEnvName('name')).toBe('COGNITO_DEFAULT_NAME');
  });

  it('reads Cognito default attributes from environment variables', () => {
    process.env.COGNITO_DEFAULT_EMAIL = 'dev+{username}@beautyonwheels.test';
    process.env.COGNITO_DEFAULT_PHONE_NUMBER = '+1{digits}';
    process.env.COGNITO_DEFAULT_NAME = 'Beauty On Wheels User';

    expect(getCognitoAttributeDefaults()).toEqual({
      email: 'dev+{username}@beautyonwheels.test',
      phone_number: '+1{digits}',
      name: 'Beauty On Wheels User',
    });
  });

  it('omits unset default attributes', () => {
    delete process.env.COGNITO_DEFAULT_EMAIL;
    delete process.env.COGNITO_DEFAULT_PHONE_NUMBER;
    delete process.env.COGNITO_DEFAULT_NAME;

    expect(getCognitoAttributeDefaults()).toEqual({});
  });

  it('includes default attributes on getCognitoConfig', () => {
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_testpool';
    process.env.COGNITO_APP_CLIENT_ID = 'test-client';
    process.env.COGNITO_DEFAULT_NAME = 'Pool Default Name';

    const config = getCognitoConfig();
    expect(config.defaultAttributes).toEqual({
      name: 'Pool Default Name',
    });
  });

  it('reads optional Cognito app client secret from the environment', () => {
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_testpool';
    process.env.COGNITO_APP_CLIENT_ID = 'test-client';
    process.env.COGNITO_APP_CLIENT_SECRET = '  client-secret  ';

    expect(getCognitoConfig().appClientSecret).toBe('client-secret');
  });
});
