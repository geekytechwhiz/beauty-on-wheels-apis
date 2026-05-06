import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

interface Params {
  [key: string]: unknown;
}

const handler = async (_req: LambdaRequest<Params>) => {
  return { status: 'ok', service: 'user-service' };
};

export const main = withLambdaHandler(handler);
