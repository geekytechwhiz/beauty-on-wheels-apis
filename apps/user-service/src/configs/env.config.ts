export const env = {
  SERVICE_NAME: process.env.SERVICE_NAME || 'user-service',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || '',
};
