import type {
  BaseCreateOrderCommand,
  BaseRescheduleOrderCommand,
} from '../base/base-order.command';

/**
 * Orange Health-specific fields for order creation.
 * Update after verifying Orange Health API documentation.
 */
export interface OrangeCreateOrderExtension {
  scheduledDate?: string;
  // ... other Orange-specific fields
}

export type OrangeCreateOrderCommand = BaseCreateOrderCommand &
  OrangeCreateOrderExtension;

export interface OrangeRescheduleOrderExtension {
  newScheduledDate?: string;
}

export type OrangeRescheduleOrderCommand = BaseRescheduleOrderCommand &
  OrangeRescheduleOrderExtension;
