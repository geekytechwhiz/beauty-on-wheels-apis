import { getBaseLogger } from './base';
import { getContext } from '../core/context';
import { shouldSample } from './level-sampling';
import { enforcePolicy } from './controlled-logging';
import { serializeError } from './serialize-error';
    
export function getLogger(extra?: Record<string, any>) {
  const base = getBaseLogger();
  const ctx = getContext();

  const child = base.createChild();
  child.appendKeys({
    ...ctx,
    ...extra,
    correlationId: ctx.correlationId,
    awsRequestId: ctx.awsRequestId,
    functionName: ctx.functionName,
  });

  return {
    debug: (msg: string, payload?: any) => {
      if (shouldSample('DEBUG')) {
        child.debug(msg, enforcePolicy(payload));
      }
    },

    info: (msg: string, payload?: any) => {
      if (shouldSample('INFO')) {
        child.info(msg, enforcePolicy(payload));
      }
    },

    warn: (msg: string, payload?: any) => {
      child.warn(msg, enforcePolicy(payload));
    },

    error: (msg: string, err?: unknown, payload?: any) => {
      child.error(msg, {
        ...enforcePolicy(payload),
        error: serializeError(err), // 🔥 ALWAYS structured
      });
    },
  };
}