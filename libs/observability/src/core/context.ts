import { AsyncLocalStorage } from 'node:async_hooks';

type Context = {
  correlationId: string;
  awsRequestId?: string;
  functionName?: string;
  [key: string]: any;
};

const store = new AsyncLocalStorage<Context>();

export const withContext = <T>(ctx: Context, fn: () => T) => {
  return store.run(ctx, fn);
};

export const getContext = (): Context => {
  return store.getStore() ?? { correlationId: 'unknown' };
};