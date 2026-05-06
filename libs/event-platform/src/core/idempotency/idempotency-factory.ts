import { DomainIdempotencyStrategy } from './domain-idempotency.strategy';
import {
  StoreIdempotencyStrategy,
  type IdempotencyStore,
} from './store-idempotency.strategy';
import type { IdempotencyStrategy } from './idempotency-strategy';

export type CreateIdempotencyStrategyOptions =
  | { mode: 'domain' }
  | { mode: 'store'; store: IdempotencyStore };

export function createIdempotencyStrategy(
  options: CreateIdempotencyStrategyOptions,
): IdempotencyStrategy {
  if (options.mode === 'domain') {
    return new DomainIdempotencyStrategy();
  }

  return new StoreIdempotencyStrategy(options.store);
}