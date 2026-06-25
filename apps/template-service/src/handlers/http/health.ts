import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, extractAwsRequestId, extractCorrelationId } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { getTemplateAppEnv } from '../../config/env';

const logger = createLogger({ service: 'template-service', redactPII: false });

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
    service: 'template-service',
    timestamp: new Date().toISOString(),
    requestId: awsRequestId || correlationId,
    region: getTemplateAppEnv().AWS_REGION_TEMPLATE_SERVICE,
    stage: getTemplateAppEnv().NODE_ENV,
  };

  return ApiResponse.ok(
    response,
    { title: 'OK', description: 'Template service is healthy', severity: 'INFO' },
    {
      correlationId,
      headers: {
        'X-Correlation-Id': correlationId,
        'Cache-Control': 'no-cache',
      },
    },
  );
}

export default main;
