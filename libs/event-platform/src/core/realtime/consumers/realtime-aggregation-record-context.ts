import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<{ messageId: string }>();

export function runWithAggregationRecordContext<T>(
  messageId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ messageId }, fn);
}

export function getAggregationMessageId(): string | undefined {
  return storage.getStore()?.messageId;
}
