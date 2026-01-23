import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { RootOrgMetadataRepository } from '../repositories/rootOrgMetadata.repository';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const rootOrgMetadataRepository = new RootOrgMetadataRepository();

const ORG_SIZE_PREFIX = 'ORG_SIZE';
const ORG_SCHEDULE_KEY = 'SCHEDULE';
const DEFAULT_SETTINGS_KEY = 'DEFAULT_SETTINGS';
const ORG_STATUS = ['HOLD', 'ACTIVE', 'DISABLED', 'PENDING'];

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'getOrganizationMetadata_received' });

  const typeParam = event.queryStringParameters?.type?.toUpperCase();
  const type = typeParam || 'ORGANIZATION';
  if (type !== 'ROOT' && type !== 'ORGANIZATION') {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/metadata', 400, duration, correlationId);
    return ApiResponse.badRequest(
      { title: 'Invalid request', description: 'type must be ROOT or ORGANIZATION' },
      { requestId: correlationId },
      { code: 'INVALID_TYPE' },
    );
  }

  try {
    const permissionsList = await rootOrgMetadataRepository.getRootOrgPermissionsList(type);
    const orgMetaItems = await rootOrgMetadataRepository.getOrgTypeSize();

    const orgTypes: Array<{ orgTypeId: string; name: string }> = [];
    const orgSize: Array<Record<string, unknown>> = [];
    let scheduleConf: Record<string, unknown> | undefined;
    let defaultSetting: unknown;

    for (const rawItem of orgMetaItems) {
      const item = rawItem as Record<string, any>;
      const sk = typeof item?.sk === 'string' ? item.sk : '';
      if (!sk) continue;

      if (sk.startsWith(ORG_SIZE_PREFIX)) {
        const size = sk.split('#')[1];
        const attributes = item.attributes && typeof item.attributes === 'object' ? { ...item.attributes } : {};
        (attributes as Record<string, unknown>).value = size;
        orgSize.push(attributes as Record<string, unknown>);
        continue;
      }
      if (sk === ORG_SCHEDULE_KEY) {
        scheduleConf = item.attributes as Record<string, unknown>;
        continue;
      }
      if (sk === DEFAULT_SETTINGS_KEY) {
        defaultSetting = item.attributes;
        continue;
      }

      const orgTypeId = sk.split('#')[1];
      if (orgTypeId && item.name) {
        orgTypes.push({ orgTypeId, name: item.name });
      }
    }

    orgSize.sort((a, b) => {
      const minA = typeof a?.min === 'number' ? (a.min as number) : 0;
      const minB = typeof b?.min === 'number' ? (b.min as number) : 0;
      return minA - minB;
    });

    const supportedVitals = await rootOrgMetadataRepository.getOrgSupportedVitals();
    const supportedRelations = await rootOrgMetadataRepository.getOrgSupportedRelations();
    const supportedSpecialty = await rootOrgMetadataRepository.getOrgSupportedSpecialty();

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/metadata', 200, duration, correlationId);
    return ApiResponse.ok(
      {
        items: Array.isArray(permissionsList) ? permissionsList : [],
        orgTypes,
        orgSize,
        scheduleConf,
        defaultSetting,
        supportedVitals,
        supportedRelations,
        supportedSpecialty,
        orgStatus: ORG_STATUS,
      },
      { title: 'Success', description: 'Organization metadata retrieved' },
      { requestId: correlationId },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'getOrganizationMetadata_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/metadata', 500, duration, correlationId);
    return ApiResponse.internalServerError(
      { title: 'Failed to get organization metadata', description: (err as Error)?.message || 'Unknown error' },
      { requestId: correlationId },
      { code: 'GET_ORG_METADATA_FAILED' },
    );
  }
};
