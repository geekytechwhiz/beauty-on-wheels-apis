import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  logHttpRequest,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { RootOrgMetadataRepository } from '../repositories/rootOrgMetadata.repository';

const defaultOrgVitals = require('../utils/mitadata/data/org-vitals.json') as {
  attributes?: unknown[];
};

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

const ORGANIZATION_TABLE = process.env.ORGANIZATION_TABLE;

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });

  logger.info({ event: 'health_check_received' });

  const attributes =
    defaultOrgVitals?.attributes && Array.isArray(defaultOrgVitals.attributes) ? defaultOrgVitals.attributes : [];

  if (ORGANIZATION_TABLE && attributes.length > 0) {
    try {
      const repo = new RootOrgMetadataRepository();
      await repo.putOrgVitalsMetadata(attributes);
      logger.info({ event: 'org_vitals_metadata_ensured', attributesCount: attributes.length });
    } catch (err) {
      logger.warn({
        event: 'org_vitals_metadata_insert_failed',
        err: serializeError(err as Error),
      });
    }
  } else {
    if (!ORGANIZATION_TABLE) {
      logger.warn({ event: 'org_vitals_metadata_skipped', reason: 'ORGANIZATION_TABLE not set' });
    }
    if (attributes.length === 0) {
      logger.warn({
        event: 'org_vitals_metadata_skipped',
        reason: 'no attributes to insert',
        hasDefaultOrgVitals: !!defaultOrgVitals,
        attributesType: typeof defaultOrgVitals?.attributes,
      });
    }
  }

   
  const duration = Date.now() - startTime;
  logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/health', 200, duration, correlationId);

  return ApiResponse.ok(
    { status: 'ok', service: 'organization-service' },
    'HEALTH.HEALTH_CHECK_OK',
    { requestId: correlationId, event },
  );
};
