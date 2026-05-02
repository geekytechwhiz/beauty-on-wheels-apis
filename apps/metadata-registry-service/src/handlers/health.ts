import { withLambdaHandler } from '@api-hub/middleware';
import { healthRequestSchema } from '../schemas/health.schema';

export const main = withLambdaHandler(async (req) => {
  healthRequestSchema.parse(req);
  return { status: 'ok', service: 'metadata-registry-service' };
}, {
  useCreated: false,
});
