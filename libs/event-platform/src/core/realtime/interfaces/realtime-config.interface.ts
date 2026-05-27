import type { EventTransformer } from './event-transformer.interface';
import type { RecipientResolver } from './recipient-resolver.interface';

export type RealtimeConsumerConfig = {
  enabled: boolean;
  resolver: RecipientResolver;
  transformer: EventTransformer;
};
