import type { BaseEvent } from '../../../typings/base-event.types';
import type { RealtimeMessage } from '../types/realtime-message.type';

export interface EventTransformer {
  transform(event: BaseEvent<unknown>): RealtimeMessage;
}
