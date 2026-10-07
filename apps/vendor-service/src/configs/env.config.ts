export const env = {
  SERVICE_NAME: process.env.SERVICE_NAME || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || '',
  EVENT_BUS_NAME: process.env.EVENT_BUS_NAME || '',
  DOCUMENTS_BUCKET_NAME: process.env.DOCUMENTS_BUCKET_NAME || '',
  AWS_REGION: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
  COGNITO_REGION: process.env.COGNITO_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
  COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID || '',
  COGNITO_APP_CLIENT_ID: process.env.COGNITO_APP_CLIENT_ID || '',
  COGNITO_ISSUER: process.env.COGNITO_ISSUER || '',
  COGNITO_JWKS_URI: process.env.COGNITO_JWKS_URI || '',
  CATALOG_SERVICE_URL: process.env.CATALOG_SERVICE_URL || '',
};
