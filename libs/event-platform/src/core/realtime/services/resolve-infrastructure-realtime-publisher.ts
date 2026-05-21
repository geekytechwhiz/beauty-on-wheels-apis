import type { RealtimePublisher } from '../interfaces/realtime-publisher.interface';
import { NoopRealtimePublisher } from './noop-realtime-publisher.service';

let cachedPublisher: RealtimePublisher | undefined;


export function resolveInfrastructureRealtimePublisher(): RealtimePublisher {
  if (cachedPublisher) {
    return cachedPublisher;
  }

 
  cachedPublisher = new NoopRealtimePublisher();
  return cachedPublisher;
}
 
export function resetInfrastructureRealtimePublisherCache(): void {
  cachedPublisher = undefined;
}
