import type { RealtimePublisher } from '../interfaces/realtime-publisher.interface';
import type { RealtimeMessage } from '../types/realtime-message.type';

export class NoopRealtimePublisher implements RealtimePublisher {
  async publish(_messages: RealtimeMessage[]): Promise<void> {
    /* no-op */
  }
}
