import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';

// Import the migration script (JavaScript module)
const { main } = require('../migration/script');

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

export async function metadataMigration(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'metadataMigration_received' });

  try {
    // Parse request body if present
    let body: any = {};
    if (event.body) {
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch (err) {
        logger.warn({ event: 'metadataMigration_parse_error', err: serializeError(err) });
      }
    }

    // Set environment variables for the migration script
    // These will be picked up by the CONFIG object in script.js
    const env = body.env || process.env.STAGE || 'dev';
    const batchSize = body.batchSize || parseInt(process.env.BATCH_SIZE || '100');
    const dryRun = body.dryRun !== undefined ? body.dryRun : process.env.DRY_RUN === 'true';
    const resumeFrom = body.resumeFrom || process.env.RESUME_FROM || null;

    // Set environment variables that the script will read
    process.env.ENV = env;
    process.env.STAGE = env;
    process.env.BATCH_SIZE = batchSize.toString();
    process.env.DRY_RUN = dryRun.toString();
    if (resumeFrom) {
      process.env.RESUME_FROM = resumeFrom;
    }

    logger.info({
      event: 'metadataMigration_starting',
      env,
      batchSize,
      dryRun,
      resumeFrom,
    });

    // Run the migration
    const stats = await main();

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/metadata/migrate', 200, duration, correlationId);

    return ApiResponse.ok(
      {
        message: 'Metadata migration completed successfully',
        stats,
        env,
        batchSize,
        dryRun,
        duration: `${duration}ms`,
      },
      'METADATA.MIGRATION_COMPLETED',
      { correlationId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'metadataMigration_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/metadata/migrate', 500, duration, correlationId);

    return ApiResponse.internalServerError(
      'METADATA.MIGRATION_FAILED',
      { correlationId: correlationId, event },
      {
        code: 'MIGRATION_FAILED',
        details: [{ message: (err as Error).message }],
      },
    );
  }
}
