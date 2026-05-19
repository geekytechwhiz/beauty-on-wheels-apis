import { baseCreateOrderSchema } from '../createOrder/base.createOrder.schema';
import { redcliffeCreateOrderSchema } from '../createOrder/redcliffe.createOrder.schema';
import { orangeCreateOrderSchema } from '../createOrder/orange.createOrder.schema';
import { baseRescheduleOrderSchema } from '../rescheduleOrder/base.rescheduleOrder.schema';
import { redcliffeRescheduleOrderSchema } from '../rescheduleOrder/redcliffe.rescheduleOrder.schema';
import { orangeRescheduleOrderSchema } from '../rescheduleOrder/orange.rescheduleOrder.schema';
import { baseCancelOrderSchema } from '../cancelOrder/base.cancelOrder.schema';

type CreateOrderSchema =
  | typeof baseCreateOrderSchema
  | typeof redcliffeCreateOrderSchema
  | typeof orangeCreateOrderSchema;
type RescheduleOrderSchema =
  | typeof baseRescheduleOrderSchema
  | typeof redcliffeRescheduleOrderSchema
  | typeof orangeRescheduleOrderSchema;
type CancelOrderSchema = typeof baseCancelOrderSchema;

/**
 * Returns the appropriate Zod schema for the given partner and operation.
 * This enables per-partner validation with different required/optional fields.
 */
export function getCreateOrderSchema(partnerId: string): CreateOrderSchema {
  switch (partnerId.toLowerCase()) {
    case 'redcliffe':
      return redcliffeCreateOrderSchema;
    case 'orange':
    case 'orangehealth':
      return orangeCreateOrderSchema;
    default:
      return baseCreateOrderSchema;
  }
}

export function getRescheduleOrderSchema(
  partnerId: string
): RescheduleOrderSchema {
  switch (partnerId.toLowerCase()) {
    case 'redcliffe':
      return redcliffeRescheduleOrderSchema;
    case 'orange':
    case 'orangehealth':
      return orangeRescheduleOrderSchema;
    default:
      return baseRescheduleOrderSchema;
  }
}

export function getCancelOrderSchema(): CancelOrderSchema {
  return baseCancelOrderSchema;
}
