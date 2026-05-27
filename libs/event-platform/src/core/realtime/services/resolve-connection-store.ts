import type { ConnectionStore } from '../interfaces/connection-store.interface';
import { createDynamoDbConnectionStore } from '../infra/dynamodb-connection-store';

let cachedStore: ConnectionStore | undefined;

export function resolveConnectionStore(): ConnectionStore {
  if (cachedStore) {
    return cachedStore;
  }

  cachedStore = createDynamoDbConnectionStore();
  return cachedStore;
}

export function resetConnectionStoreCache(): void {
  cachedStore = undefined;
}
