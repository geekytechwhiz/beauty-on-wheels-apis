import { withContext } from '../core/context';
import { normalizeContext } from '../core/normalize-context';
import { getBaseLogger } from '../logger/base';

let initialized = false;

export const withLambdaObservability =
  (handler: any) =>
  async (event: any, context: any) => {
    if (!initialized) {
      getBaseLogger();
      initialized = true;
    }

    const ctx = normalizeContext(event, context);

    return withContext(ctx, () => handler(event, context));
  };