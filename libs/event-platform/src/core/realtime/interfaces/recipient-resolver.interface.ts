import type { BaseEvent } from '../../../typings/base-event.types';
import type { RealtimeRecipient } from '../types/realtime-recipient.type';

export interface RecipientResolver {
  resolve(event: BaseEvent<unknown>): Promise<RealtimeRecipient[]>;
}
