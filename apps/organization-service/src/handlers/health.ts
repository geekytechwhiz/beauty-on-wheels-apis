import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { RootOrgMetadataRepository } from '../repositories/rootOrgMetadata.repository';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const defaultOrgVitals = require('../utils/mitadata/data/org-vitals.json') as { attributes: unknown[] };

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });

  logger.info({ event: 'health_check_received' });

  try {
    const repo = new RootOrgMetadataRepository();
    await repo.putOrgVitalsMetadata(defaultOrgVitals.attributes);
    logger.info({ event: 'org_vitals_metadata_ensured' });
  } catch (err) {
    logger.warn({ event: 'org_vitals_metadata_insert_failed', err: (err as Error)?.message });
  }

  const duration = Date.now() - startTime;
  logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/health', 200, duration, correlationId);

  return ApiResponse.ok(
    { status: 'ok', service: 'organization-service' },
    'HEALTH.HEALTH_CHECK_OK',
    { requestId: correlationId, event },
  );
};
