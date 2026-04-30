// core/idempotency/idempotency-factory.ts

import { DomainIdempotencyStrategy } from './domain-idempotency.strategy';
import { StoreIdempotencyStrategy } from './store-idempotency.strategy';

export function createIdempotencyStrategy(options: {
  mode: 'domain' | 'store';
  store?: any;
}) {
  if (options.mode === 'domain') {
    return new DomainIdempotencyStrategy();
  }

  return new StoreIdempotencyStrategy(options.store);
}