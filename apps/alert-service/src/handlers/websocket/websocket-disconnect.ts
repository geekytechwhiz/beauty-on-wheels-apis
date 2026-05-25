import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  buildEventExecutionPipeline,
  runMiddlewares,
  type MiddlewarePipelineEvent,
} from '@api-hub/middleware';
import { createWebSocketDisconnectHandler } from '@api-hub/event-platform';

const stack = buildEventExecutionPipeline<APIGatewayProxyResultV2>({
  operation: 'websocket.disconnect',
});

const disconnectHandler = createWebSocketDisconnectHandler();

export const main = runMiddlewares<
  MiddlewarePipelineEvent,
  APIGatewayProxyResultV2,
  unknown
>(
  stack,
  disconnectHandler as unknown as (
    event: MiddlewarePipelineEvent,
    context: unknown,
  ) => Promise<APIGatewayProxyResultV2>,
);
