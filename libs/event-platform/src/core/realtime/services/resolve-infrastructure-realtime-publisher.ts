import type { RealtimePublisher } from '../interfaces/realtime-publisher.interface';
import {
  resetSocketRealtimePublisherCache,
  resolveSocketRealtimePublisher,
} from './resolve-socket-realtime-publisher';

let cachedPublisher: RealtimePublisher | undefined;

export function resolveInfrastructureRealtimePublisher(): RealtimePublisher {
  if (cachedPublisher) {
    return cachedPublisher;
  }

  cachedPublisher = resolveSocketRealtimePublisher();
  return cachedPublisher;
}

export function resetInfrastructureRealtimePublisherCache(): void {
  cachedPublisher = undefined;
  resetSocketRealtimePublisherCache();
}
