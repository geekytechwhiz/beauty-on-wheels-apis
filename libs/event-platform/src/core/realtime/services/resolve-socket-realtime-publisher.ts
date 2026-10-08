import type { RealtimePublisher } from '../interfaces/realtime-publisher.interface';
import { SocketRealtimePublisher } from '../publishers/socket-realtime-publisher.service';

let cachedPublisher: RealtimePublisher | undefined;

export function resolveSocketRealtimePublisher(): RealtimePublisher {
  if (cachedPublisher) {
    return cachedPublisher;
  }

  cachedPublisher = new SocketRealtimePublisher();
  return cachedPublisher;
}

export function resetSocketRealtimePublisherCache(): void {
  cachedPublisher = undefined;
}
