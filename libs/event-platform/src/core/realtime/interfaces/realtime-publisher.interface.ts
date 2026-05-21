import type { RealtimeMessage } from '../types/realtime-message.type';

export interface RealtimePublisher {
  publish(messages: RealtimeMessage[]): Promise<void>;
}
