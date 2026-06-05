import { APIGatewayProxyEvent } from 'aws-lambda';
import { createLogger, createChildLogger } from '@api-hub/observability';
import { getEnvConfig } from '../config/env';
import { RateLimitState } from '../types/domain/appointment.types';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });
const logger = createChildLogger(baseLogger, { component: 'sso-integration' });

const rateLimitStore = new Map<string, RateLimitState>();

const CLEANUP_INTERVAL_MS = 60000;
let lastCleanup = Date.now();

function cleanupExpiredEntries(): void {
  const now = Date.now();
  
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) {
    return;
  }

  lastCleanup = now;
  let cleaned = 0;

  for (const [key, state] of rateLimitStore.entries()) {
    if (state.resetAt < now) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug({
      event: 'rate_limit_cleanup',
      entriesRemoved: cleaned,
      remainingEntries: rateLimitStore.size,
    });
  }
}

function getClientIdentifier(event: APIGatewayProxyEvent): string {
  const sourceIp = event.requestContext?.identity?.sourceIp;
  const forwardedFor = event.headers?.['X-Forwarded-For'];
  
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0].trim();
    return `ip:${firstIp}`;
  }
  
  if (sourceIp) {
    return `ip:${sourceIp}`;
  }
  
  return 'unknown';
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export function checkRateLimit(event: APIGatewayProxyEvent): RateLimitResult {
  const config = getEnvConfig();
  const windowMs = config.RATE_LIMIT_WINDOW_MS;
  const maxRequests = config.RATE_LIMIT_MAX_REQUESTS;
  
  const clientId = getClientIdentifier(event);
  const now = Date.now();

  cleanupExpiredEntries();

  let state = rateLimitStore.get(clientId);

  if (!state || state.resetAt < now) {
    state = {
      count: 0,
      resetAt: now + windowMs,
    };
  }

  state.count++;
  rateLimitStore.set(clientId, state);

  const remaining = Math.max(0, maxRequests - state.count);
  const allowed = state.count <= maxRequests;

  if (!allowed) {
    logger.warn({
      event: 'rate_limit_exceeded',
      clientId,
      count: state.count,
      limit: maxRequests,
      resetAt: new Date(state.resetAt).toISOString(),
    });
  }

  return {
    allowed,
    remaining,
    resetAt: state.resetAt,
    limit: maxRequests,
  };
}

export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
  };
}

