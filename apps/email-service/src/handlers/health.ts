import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';

const handler = async (_req: LambdaRequest) => ({
  status: 'ok',
  service: 'email-service',
});

export const main = withApiHandler({ operation: 'email.health' }, handler);
