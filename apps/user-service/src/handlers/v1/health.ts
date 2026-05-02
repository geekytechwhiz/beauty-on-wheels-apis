import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';

interface Params {
  [key: string]: unknown;
}

const handler = async (_req: LambdaRequest<Params>) => {
  return { status: 'ok', service: 'user-service' };
};

export const main =   withApiHandler(
          {
            operation: 'health',
            
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await (handler as any)(req);

            return successResponse(result, undefined, { correlationId });
          }
        );
