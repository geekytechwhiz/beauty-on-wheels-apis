import {  withApiHandler } from '@api-hub/middleware';
import { healthRequestSchema } from '../../schemas/health.schema';

export const main =   withApiHandler(
  {
    operation: 'health',
  },
  async (req) => {
    return await (
      (async (req) => {
        healthRequestSchema.parse(req);
        return { status: 'ok', service: 'metadata-registry-service' };
      }) as any
    )(req);
  },
);
