import type { BaseEvent } from '../../../typings/base-event.types';
import type { RealtimeConsumerConfig } from '../interfaces/realtime-config.interface';

export type RealtimeProcessContext = {
  event: BaseEvent<unknown>;
  config: RealtimeConsumerConfig;
};

export type RealtimeProcessResult = {
  recipientCount: number;
};
