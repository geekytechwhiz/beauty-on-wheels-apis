const DEFAULT_OTP_DEV_CODE = '123456';

export const env = {
  SERVICE_NAME: process.env.SERVICE_NAME || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || '',
  get STAGE() {
    return process.env.STAGE || process.env.SERVERLESS_STAGE || '';
  },
  get NODE_ENV() {
    return process.env.NODE_ENV || '';
  },
  get OTP_DEV_CODE() {
    const configured = (process.env.OTP_DEV_CODE || DEFAULT_OTP_DEV_CODE).trim();
    return configured || DEFAULT_OTP_DEV_CODE;
  },
  COGNITO_REGION: process.env.COGNITO_REGION || process.env.REGION || '',
  COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID || '',
  COGNITO_APP_CLIENT_ID: process.env.COGNITO_APP_CLIENT_ID || '',
  COGNITO_ISSUER: process.env.COGNITO_ISSUER || '',
  COGNITO_JWKS_URI: process.env.COGNITO_JWKS_URI || '',
  get COGNITO_DEFAULT_EMAIL() {
    return process.env.COGNITO_DEFAULT_EMAIL || '';
  },
  get COGNITO_DEFAULT_PHONE_NUMBER() {
    return process.env.COGNITO_DEFAULT_PHONE_NUMBER || '';
  },
  get COGNITO_DEFAULT_NAME() {
    return process.env.COGNITO_DEFAULT_NAME || '';
  },
};
