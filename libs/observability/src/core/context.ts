import { AsyncLocalStorage } from 'node:async_hooks';

export type Context = {
  correlationId: string;
  awsRequestId?: string;
  functionName?: string;
  [key: string]: any;
};

const store = new AsyncLocalStorage<Context>();

export const withContext = <T>(ctx: Partial<Context>, fn: () => T) => {
  const merged: Context = {
    correlationId: ctx.correlationId ?? 'unknown',
    ...ctx,
  };
  return store.run(merged, fn);
};

export const getContext = (): Context => {
  return store.getStore() ?? { correlationId: 'unknown' };
};