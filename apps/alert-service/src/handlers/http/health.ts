import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId } from '@api-hub/logger';
import { ApiResponse }  from '@api-hub/utils';

const logger = createLogger({ service: 'alert-service', redactPII: false });

interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  service: string;
  timestamp: string;
  requestId?: string;
  region?: string;
  stage?: string;
}

export async function main(
  event: APIGatewayProxyEvent,
  context?: Context,
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
    service: 'alert-service',
    timestamp: new Date().toISOString(),
    requestId: awsRequestId || correlationId,
    region: process.env.AWS_REGION,
    stage: process.env.NODE_ENV,
  };

  return ApiResponse.ok(
    response,
    { title: 'OK', description: 'Alert service is healthy', severity: 'INFO' },
    {
      requestId: correlationId,
      headers: {
        'X-Correlation-Id': correlationId,
        'Cache-Control': 'no-cache',
      },
    },
  );
}
