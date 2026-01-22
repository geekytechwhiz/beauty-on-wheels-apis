import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { RootOrgMetadataRepository } from '../repositories/rootOrgMetadata.repository';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const metadataRepository = new RootOrgMetadataRepository();

const ORGANIZATION_STATUS = ['HOLD', 'ACTIVE', 'DISABLED', 'PENDING'];
const ORG_SIZE_PREFIX = 'ORG_SIZE';
const ORG_SCHEDULE_KEY = 'SCHEDULE';
const DEFAULT_SETTINGS = 'DEFAULT_SETTINGS';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'getOrganizationMetadata_received' });

  const typeRaw = event.queryStringParameters?.type || event.queryStringParameters?.Type;
  const type = typeRaw ? String(typeRaw).toUpperCase() : 'ORGANIZATION';
  if (type !== 'ROOT' && type !== 'ORGANIZATION') {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/metadata', 400, duration, correlationId);
    return ApiResponse.badRequest(
      { title: 'Invalid request', description: 'Type is invalid' },
      { requestId: correlationId },
      { code: 'INVALID_TYPE' },
    );
  }

  try {
    const [permissions, orgMetaItems, vitals, relations, specialty] = await Promise.all([
      metadataRepository.getRootOrgPermissionsList(type as 'ROOT' | 'ORGANIZATION'),
      metadataRepository.getOrgTypeSize(),
      metadataRepository.getOrgSupportedVitals(),
      metadataRepository.getOrgSupportedRelations(),
      metadataRepository.getOrgSupportedSpecialty(),
    ]);

    let sizeArr: Array<Record<string, unknown>> = [];
    const typeArr: Array<{ orgTypeId: string; name: string }> = [];
    let scheduleConf: Record<string, unknown> = {};
    let defaultSetting: Record<string, unknown> | string = '';

    for (const item of orgMetaItems) {
      const sk = String(item?.sk || '');
      if (sk.startsWith(`${ORG_SIZE_PREFIX}#`)) {
        const size = sk.split('#')[1];
        const attrs = item?.attributes ?? {};
        sizeArr.push({ ...(attrs as Record<string, unknown>), value: size });
      } else if (sk === ORG_SCHEDULE_KEY) {
        scheduleConf = (item?.attributes ?? {}) as Record<string, unknown>;
      } else if (sk === DEFAULT_SETTINGS) {
        defaultSetting = (item?.attributes ?? {}) as Record<string, unknown>;
      } else if (sk.includes('#')) {
        const orgTypeId = sk.split('#')[1];
        const name = item?.name ?? item?.attributes?.name;
        if (orgTypeId && name) {
          typeArr.push({ orgTypeId, name });
        }
      }
    }

    sizeArr = sizeArr.sort((a, b) => {
      const aMin = Number((a as any).min ?? 0);
      const bMin = Number((b as any).min ?? 0);
      return aMin - bMin;
    });

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/metadata', 200, duration, correlationId);
    return ApiResponse.ok(
      {
        permissions,
        orgTypes: typeArr,
        orgSize: sizeArr,
        scheduleConf,
        defaultSetting,
        supportedVitals: vitals,
        supportedRelations: relations,
        supportedSpecialty: specialty,
        orgStatus: ORGANIZATION_STATUS,
      },
      { title: 'Success', description: 'Organization metadata retrieved' },
      { requestId: correlationId },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'getOrganizationMetadata_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/metadata', 500, duration, correlationId);
    return ApiResponse.internalServerError(
      { title: 'Failed to fetch organization metadata', description: (err as Error)?.message || 'Unknown error' },
      { requestId: correlationId },
      { code: 'GET_ORG_METADATA_FAILED' },
    );
  }
};
