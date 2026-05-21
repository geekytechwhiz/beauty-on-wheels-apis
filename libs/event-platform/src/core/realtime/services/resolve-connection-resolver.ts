import type { ConnectionResolver } from '../interfaces/connection-resolver.interface';
import { NoopConnectionResolver } from './noop-connection-resolver.service';

let cachedResolver: ConnectionResolver | undefined;

export function resolveConnectionResolver(): ConnectionResolver {
  if (cachedResolver) {
    return cachedResolver;
  }

  cachedResolver = new NoopConnectionResolver();
  return cachedResolver;
}

export function resetConnectionResolverCache(): void {
  cachedResolver = undefined;
}
