const DEFAULT_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_URL_EXPIRY_SECONDS = 900;
const MAX_URL_EXPIRY_SECONDS = 3600;

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function expirySeconds(value: string | undefined): number {
  return Math.min(
    positiveInt(value, DEFAULT_URL_EXPIRY_SECONDS),
    MAX_URL_EXPIRY_SECONDS,
  );
}

function contentTypes(value: string | undefined): string[] {
  const parsed = (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_DOCUMENT_CONTENT_TYPES];
}

const documentBucket =
  process.env.DOCUMENT_BUCKET || process.env.DOCUMENTS_BUCKET_NAME || '';

export const env = {
  SERVICE_NAME: process.env.SERVICE_NAME || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || '',
  IDENTITY_TABLE: process.env.IDENTITY_TABLE || '',
  EVENT_BUS_NAME: process.env.EVENT_BUS_NAME || '',
  DOCUMENT_BUCKET: documentBucket,
  DOCUMENTS_BUCKET_NAME: documentBucket,
  DOCUMENT_UPLOAD_URL_EXPIRY: expirySeconds(process.env.DOCUMENT_UPLOAD_URL_EXPIRY),
  DOCUMENT_DOWNLOAD_URL_EXPIRY: expirySeconds(
    process.env.DOCUMENT_DOWNLOAD_URL_EXPIRY,
  ),
  DOCUMENT_MAX_FILE_SIZE: positiveInt(
    process.env.DOCUMENT_MAX_FILE_SIZE,
    DEFAULT_MAX_FILE_SIZE,
  ),
  DOCUMENT_ALLOWED_CONTENT_TYPES: contentTypes(
    process.env.DOCUMENT_ALLOWED_CONTENT_TYPES,
  ),
  AWS_REGION: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
  COGNITO_REGION: process.env.COGNITO_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
  COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID || '',
  COGNITO_APP_CLIENT_ID: process.env.COGNITO_APP_CLIENT_ID || '',
  COGNITO_ISSUER: process.env.COGNITO_ISSUER || '',
  COGNITO_JWKS_URI: process.env.COGNITO_JWKS_URI || '',
  CATALOG_SERVICE_URL: process.env.CATALOG_SERVICE_URL || '',
};
