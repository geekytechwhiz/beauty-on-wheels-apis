import type { ConnectionResolver } from '../interfaces/connection-resolver.interface';
import { DynamoDbConnectionResolver } from './dynamodb-connection-resolver.service';
import { resolveConnectionStore, resetConnectionStoreCache } from './resolve-connection-store';

let cachedResolver: ConnectionResolver | undefined;

export function resolveConnectionResolver(): ConnectionResolver {
  if (cachedResolver) {
    return cachedResolver;
  }

  cachedResolver = new DynamoDbConnectionResolver(resolveConnectionStore());
  return cachedResolver;
}

export function resetConnectionResolverCache(): void {
  cachedResolver = undefined;
  resetConnectionStoreCache();
}
