import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  buildEventExecutionPipeline,
  runMiddlewares,
  type MiddlewarePipelineEvent,
} from '@api-hub/middleware';
import { createWebSocketConnectHandler } from '@api-hub/event-platform';

const stack = buildEventExecutionPipeline<APIGatewayProxyResultV2>({
  operation: 'websocket.connect',
});

const connectHandler = createWebSocketConnectHandler();

export const main = runMiddlewares<
  MiddlewarePipelineEvent,
  APIGatewayProxyResultV2,
  unknown
>(
  stack,
  connectHandler as unknown as (
    event: MiddlewarePipelineEvent,
    context: unknown,
  ) => Promise<APIGatewayProxyResultV2>,
);
