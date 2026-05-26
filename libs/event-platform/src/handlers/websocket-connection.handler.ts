import type {
  APIGatewayEventWebsocketRequestContextV2,
  APIGatewayProxyEventQueryStringParameters,
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';
import { createLogger } from '@api-hub/observability';

import type { ConnectionStore } from '../core/realtime/interfaces/connection-store.interface';
import { resolveConnectionStore } from '../core/realtime/services/resolve-connection-store';
import {
  deriveConnectDestinations,
  parseCommaSeparatedList,
} from '../core/realtime/utils/derive-connect-destinations';

const logger = createLogger({ service: 'websocket-connection-handler' });

type WebSocketConnectAuthorizerContext = {
  userId?: string;
  organizationId?: string;
  tenantId?: string;
};

type APIGatewayEventWebsocketConnectRequestContextV2 =
  APIGatewayEventWebsocketRequestContextV2 & {
    authorizer?: WebSocketConnectAuthorizerContext;
  };

/** $connect payload includes query params and optional authorizer context. */
export type APIGatewayProxyWebsocketConnectEventV2 = Omit<
  APIGatewayProxyWebsocketEventV2,
  'requestContext'
> & {
  queryStringParameters?: APIGatewayProxyEventQueryStringParameters;
  requestContext: APIGatewayEventWebsocketConnectRequestContextV2;
};

export type APIGatewayProxyWebsocketDisconnectEventV2 =
  APIGatewayProxyWebsocketEventV2;

export type WebSocketConnectHandlerOptions = {
  store?: ConnectionStore;
  resolveConnectContext?: (
    event: APIGatewayProxyWebsocketConnectEventV2,
  ) => WebSocketConnectContextInput;
};

export type WebSocketConnectContextInput = {
  userId?: string;
  organizationId?: string;
  channels?: string[];
  extraDestinations?: string[];
};

export type WebSocketDisconnectHandlerOptions = {
  store?: ConnectionStore;
};

function defaultConnectContext(
  event: APIGatewayProxyWebsocketConnectEventV2,
): WebSocketConnectContextInput {
  const qs = event.queryStringParameters ?? {};
  const authorizer = event.requestContext.authorizer;

  return {
    userId: authorizer?.userId ?? qs.userId,
    organizationId:
      authorizer?.organizationId ?? authorizer?.tenantId ?? qs.organizationId,
    channels: parseCommaSeparatedList(qs.channels),
    extraDestinations: parseCommaSeparatedList(qs.destinations),
  };
}

export function createWebSocketConnectHandler(
  options: WebSocketConnectHandlerOptions = {},
): (
  event: APIGatewayProxyWebsocketConnectEventV2,
) => Promise<APIGatewayProxyResultV2> {
  const store = options.store ?? resolveConnectionStore();
  const resolveContext = options.resolveConnectContext ?? defaultConnectContext;

  return async (event) => {
    const connectionId = event.requestContext.connectionId;
    const context = resolveContext(event);
    const destinations = deriveConnectDestinations(context);

    if (destinations.length === 0) {
      logger.warn({
        event: 'realtime.connection.connect_skipped',
        message: 'WebSocket connect ignored — no destinations derived',
        connectionId,
      });
      return { statusCode: 400, body: 'No subscription destinations' };
    }

    await store.registerSubscriptions({ connectionId, destinations });

    logger.info({
      event: 'realtime.connection.connected',
      message: 'WebSocket connection registered',
      connectionId,
      destinationCount: destinations.length,
      userId: context.userId,
      organizationId: context.organizationId,
    });

    return { statusCode: 200, body: 'Connected' };
  };
}

export function createWebSocketDisconnectHandler(
  options: WebSocketDisconnectHandlerOptions = {},
): (
  event: APIGatewayProxyWebsocketDisconnectEventV2,
) => Promise<APIGatewayProxyResultV2> {
  const store = options.store ?? resolveConnectionStore();

  return async (event) => {
    const connectionId = event.requestContext.connectionId;
    await store.unregisterConnection(connectionId);

    logger.info({
      event: 'realtime.connection.disconnected',
      message: 'WebSocket connection removed',
      connectionId,
    });

    return { statusCode: 200, body: 'Disconnected' };
  };
}

type WebSocketConnectHandler = ReturnType<typeof createWebSocketConnectHandler>;
type WebSocketDisconnectHandler = ReturnType<typeof createWebSocketDisconnectHandler>;

let defaultConnectHandler: WebSocketConnectHandler | undefined;
let defaultDisconnectHandler: WebSocketDisconnectHandler | undefined;

function getDefaultConnectHandler(): WebSocketConnectHandler {
  defaultConnectHandler ??= createWebSocketConnectHandler();
  return defaultConnectHandler;
}

function getDefaultDisconnectHandler(): WebSocketDisconnectHandler {
  defaultDisconnectHandler ??= createWebSocketDisconnectHandler();
  return defaultDisconnectHandler;
}

/** Default API Gateway WebSocket $connect handler (lazy — avoids env lookup at import time). */
export const websocketConnectHandler: WebSocketConnectHandler = (event) =>
  getDefaultConnectHandler()(event);
export const websocketConnectMain = websocketConnectHandler;

/** Default API Gateway WebSocket $disconnect handler (lazy — avoids env lookup at import time). */
export const websocketDisconnectHandler: WebSocketDisconnectHandler = (event) =>
  getDefaultDisconnectHandler()(event);
export const websocketDisconnectMain = websocketDisconnectHandler;
