import { APIGatewayProxyevent: any, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';

const logger = createLogger({ service: 'sso-integration', redactPII: false });

interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  service: string;
  version: string;
  timestamp: string;
  requestId?: string;
  region?: string;
  stage?: string;
}

export async function handler(
  event: APIGatewayProxyevent: any,
  context?: Context
): Promise<APIGatewayProxyResult> {
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  logger.info({
    event: 'health_check',
    correlationId,
    awsRequestId,
  });

  const response: HealthResponse = {
    status: 'healthy',
    service: 'sso-integration',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    requestId: awsRequestId || correlationId,
    region: process.env.AWS_REGION,
    stage: process.env.NODE_ENV,
  };

  return ApiResponse.ok(
    response,
    { title: 'OK', description: 'SSO integration service is healthy', severity: 'INFO' },
    {
       correlationId: correlationId,
      headers: {
        'X-Correlation-Id': correlationId,
        'Cache-Control': 'no-cache',
      },
    },
  );
}
