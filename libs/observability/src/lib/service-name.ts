/**
 * Canonical service identity for logs, metrics, and tracing.
 * Required whenever running in AWS Lambda; optional only for local (non-Lambda) development.
 */
export function requireServiceName(): string {
  const name = process.env.SERVICE_NAME?.trim();
  if (name) {
    return name;
  }
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === 'production') {
    throw new Error('SERVICE_NAME environment variable is required in Lambda and in production');
  }
  return 'local-dev-service';
}
