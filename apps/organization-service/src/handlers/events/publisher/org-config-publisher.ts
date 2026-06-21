import { createChildLogger, createLogger, serializeError } from '@api-hub/observability';
import { publishEvent } from '@api-hub/event-platform';

import { configureEventRuntime } from '../bootstrap/event-runtime';
import {
  OrgConfigPublishedEventSchema,
  type OrgConfigPublishedPayload,
} from '../outbound/org-config-published.event';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

const CREDENTIAL_OR_AUTH_ERROR_CODES = [
  'UnrecognizedClientException',
  'InvalidClientTokenId',
  'SignatureDoesNotMatch',
  'AccessDeniedException',
  'InvalidAccessKeyId',
  'ExpiredToken',
  'ExpiredTokenException',
] as const;

function isNonProdRelaxed(): boolean {
  if (process.env.IS_OFFLINE === 'true') {
    return true;
  }

  const stage = String(
    process.env.STAGE || process.env.SERVERLESS_STAGE || process.env.SLS_STAGE || '',
  ).toLowerCase();

  return (
    stage === 'local' ||
    stage === 'dev' ||
    stage === 'development' ||
    stage === 'test' ||
    stage === 'offline' ||
    stage === ''
  );
}

function resolvePublishErrorCode(err: unknown): string {
  const e = err as { name?: string; code?: string; Code?: string; message?: string };
  const fromMeta = e.code || e.Code;
  if (fromMeta && String(fromMeta) !== 'Error') return String(fromMeta);
  if (e.name && e.name !== 'Error') return e.name;
  const msg = (e.message || '').trim();
  for (const code of CREDENTIAL_OR_AUTH_ERROR_CODES) {
    if (msg === code || msg.includes(code)) return code;
  }
  return e.name || '';
}

function shouldTolerateEventBridgeFailure(err: unknown): boolean {
  if (String(process.env.ORG_CONFIG_EVENT_PUBLISH_BYPASS || '').toLowerCase() === 'true') {
    return true;
  }
  if (!isNonProdRelaxed()) {
    return false;
  }
  const code = resolvePublishErrorCode(err);
  return CREDENTIAL_OR_AUTH_ERROR_CODES.includes(code as (typeof CREDENTIAL_OR_AUTH_ERROR_CODES)[number]);
}

/**
 * Publishes `OrgConfigPublished.v1` via EventBridge (`@api-hub/event-platform`).
 * Failures propagate in prod; offline / non-prod IAM gaps are logged and skipped
 * (mirrors legacy SNS `event.publisher.ts` local-dev behavior).
 */
export async function publishOrgConfigPublishedEvent(
  payload: OrgConfigPublishedPayload,
  options: { organizationId: string; correlationId: string },
): Promise<void> {
  const logger = createChildLogger(baseLogger, {
    correlationId: options.correlationId,
    organizationId: options.organizationId,
  });

  if (process.env.IS_OFFLINE === 'true') {
    logger.info({
      event: 'org_config_published_event_skipped_offline',
      payload,
    });
    return;
  }

  configureEventRuntime();

  try {
    await publishEvent(OrgConfigPublishedEventSchema, payload, {
      meta: {
        tenantId: options.organizationId,
        correlationId: options.correlationId,
      },
    });
  } catch (err) {
    if (shouldTolerateEventBridgeFailure(err)) {
      logger.warn({
        event: 'org_config_published_event_skipped_nonprod',
        code: resolvePublishErrorCode(err),
        err: serializeError(err),
        payload,
      });
      return;
    }
    throw err;
  }
}
