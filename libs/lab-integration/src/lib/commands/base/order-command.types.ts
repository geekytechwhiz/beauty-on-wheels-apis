import type {
  RedcliffeCreateOrderCommand,
  RedcliffeRescheduleOrderCommand,
} from '../redcliffe/redcliffe-order.extension';
import type {
  OrangeCreateOrderCommand,
  OrangeRescheduleOrderCommand,
} from '../orange/orange-order.extension';

export type CreateOrderCommand =
  | RedcliffeCreateOrderCommand
  | OrangeCreateOrderCommand;
export type RescheduleOrderCommand =
  | RedcliffeRescheduleOrderCommand
  | OrangeRescheduleOrderCommand;
