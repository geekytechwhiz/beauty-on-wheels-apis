import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { createLogger, getLoggerContext } from '@api-hub/observability';
import { getTracerForService } from '@api-hub/middleware';
import type { Tracer } from '@aws-lambda-powertools/tracer';

import type { ConnectionResolver } from '../interfaces/connection-resolver.interface';
import type {
  SocketPublishContext,
  SocketService,
} from '../interfaces/socket-service.interface';
import { traceRealtimeAsync } from '../utils/trace-realtime-async';

const logger = createLogger();
const tracer = getTracerForService('event-platform-realtime');

export type ApiGatewaySocketServiceOptions = {
  endpoint?: string;
  region?: string;
  connectionResolver: ConnectionResolver;
  client?: ApiGatewayManagementApiClient;
  tracerInstance?: Tracer;
};

function resolveCorrelationId(context?: SocketPublishContext): string | undefined {
  return context?.correlationId ?? getLoggerContext()?.correlationId;
}

function isStaleConnectionError(error: unknown): boolean {
  if (error instanceof GoneException) {
    return true;
  }
  if (error && typeof error === 'object') {
    const name = (error as { name?: string }).name;
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    return name === 'GoneException' || status === 410;
  }
  return false;
}

function logPublishFailure(
  error: unknown,
  meta: {
    destination: string;
    connectionId: string;
    correlationId?: string;
    eventType?: string;
  },
): void {
  const stale = isStaleConnectionError(error);
  logger.warn({
    event: 'realtime.socket.publish_failed',
    message: stale
      ? 'WebSocket connection expired'
      : 'WebSocket publish failed',
    destination: meta.destination,
    connectionId: meta.connectionId,
    correlationId: meta.correlationId,
    eventType: meta.eventType,
    staleConnection: stale,
    error,
  });
}

export class ApiGatewaySocketService implements SocketService {
  private readonly client: ApiGatewayManagementApiClient;
  private readonly connectionResolver: ConnectionResolver;
  private readonly activeTracer: Tracer;

  constructor(options: ApiGatewaySocketServiceOptions) {
    const endpoint =
      (typeof options.endpoint === 'string' && options.endpoint.trim()) ||
      (typeof process.env.WEBSOCKET_API_ENDPOINT === 'string' &&
        process.env.WEBSOCKET_API_ENDPOINT.trim()) ||
      '';

    const region =
      options.region ??
      process.env.AWS_REGION ??
      process.env.AWS_DEFAULT_REGION ??
      'us-east-1';

    this.connectionResolver = options.connectionResolver;
    this.activeTracer = options.tracerInstance ?? tracer;

    this.client =
      options.client ??
      new ApiGatewayManagementApiClient({
        endpoint: endpoint || undefined,
        region,
      });
  }

  async publish(
    destination: string,
    payload: Record<string, unknown>,
    context?: SocketPublishContext,
  ): Promise<void> {
    const correlationId = resolveCorrelationId(context);
    const eventType = context?.eventType;

    const run = async (): Promise<void> => {
      const connectionIds = await this.connectionResolver.resolve(destination);
      const connectionCount = connectionIds.length;

      logger.info({
        event: 'realtime.socket.publish',
        message: 'Realtime socket publish',
        destination,
        connectionCount,
        correlationId,
        eventType,
      });

      if (connectionCount === 0) {
        return;
      }

      const body = JSON.stringify(payload);
      const results = await Promise.allSettled(
        connectionIds.map((connectionId) =>
          this.client.send(
            new PostToConnectionCommand({
              ConnectionId: connectionId,
              Data: new TextEncoder().encode(body),
            }),
          ),
        ),
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          logPublishFailure(result.reason, {
            destination,
            connectionId: connectionIds[i] ?? 'unknown',
            correlationId,
            eventType,
          });
        }
      }
    };

    await traceRealtimeAsync(
      this.activeTracer,
      'ApiGatewaySocketService.publish',
      run,
    );
  }
}
