import { withApiHandler, type withApiHandlerOptions } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';


type VendorHandler = (request: LambdaRequest) => Promise<unknown>;

/**
 * HTTP handlers resolve the application user id before validation and before
 * the request context is frozen.
 */
export function withVendorApiHandler(
  options: withApiHandlerOptions,
  handler: VendorHandler,
) {
  const validator = options.validator;
  return withApiHandler(
    {
      ...options,
      validator: async (request: LambdaRequest) => {
     
        if (validator) {
          await validator(request);
        }
      },
    },
    handler,
  );
}
