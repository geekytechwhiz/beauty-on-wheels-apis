import { z } from 'zod';

import { DELIVERY_STATUS, type DeliveryStatus } from '../domain/delivery-status.js';

export const SES_LIFECYCLE_EVENT = {
  SEND: 'Send',
  DELIVERY: 'Delivery',
  BOUNCE: 'Bounce',
  COMPLAINT: 'Complaint',
  REJECT: 'Reject',
} as const;

export const SesLifecycleEventSchema = z
  .object({
    eventType: z.enum([
      SES_LIFECYCLE_EVENT.SEND,
      SES_LIFECYCLE_EVENT.DELIVERY,
      SES_LIFECYCLE_EVENT.BOUNCE,
      SES_LIFECYCLE_EVENT.COMPLAINT,
      SES_LIFECYCLE_EVENT.REJECT,
    ]),
    mail: z
      .object({
        messageId: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export type SesLifecycleEvent = z.infer<typeof SesLifecycleEventSchema>;

export function deliveryStatusForSesEvent(eventType: SesLifecycleEvent['eventType']): DeliveryStatus {
  switch (eventType) {
    case SES_LIFECYCLE_EVENT.SEND:
      return DELIVERY_STATUS.SENT;
    case SES_LIFECYCLE_EVENT.DELIVERY:
      return DELIVERY_STATUS.DELIVERED;
    case SES_LIFECYCLE_EVENT.BOUNCE:
      return DELIVERY_STATUS.BOUNCED;
    case SES_LIFECYCLE_EVENT.COMPLAINT:
      return DELIVERY_STATUS.COMPLAINED;
    case SES_LIFECYCLE_EVENT.REJECT:
      return DELIVERY_STATUS.REJECTED;
    default: {
      const unexpected: never = eventType;
      return unexpected;
    }
  }
}
