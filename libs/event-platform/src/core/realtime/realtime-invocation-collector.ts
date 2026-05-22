import { AsyncLocalStorage } from 'node:async_hooks';

import type { BaseEvent } from '../../typings/base-event.types';
import type { EventConsumerDeps } from '../../typings/consumer.types';

type CollectorStore = {
  pending: BaseEvent<unknown>[];
};

const storage = new AsyncLocalStorage<CollectorStore>();

export function runWithRealtimeCollector<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ pending: [] }, fn);
}

export function recordRealtimeSuccess(
  baseEvent: BaseEvent<unknown>,
  deps: EventConsumerDeps,
): void {
  if (!deps.realtime?.enabled) {
    return;
  }
  const store = storage.getStore();
  if (!store) {
    return;
  }
  store.pending.push(baseEvent);
}

export function drainRealtimePending(): readonly BaseEvent<unknown>[] {
  const store = storage.getStore();
  if (!store || store.pending.length === 0) {
    return [];
  }
  const drained = [...store.pending];
  store.pending.length = 0;
  return drained;
}
