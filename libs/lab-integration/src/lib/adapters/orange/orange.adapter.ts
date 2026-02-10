import { BasePartnerAdapter } from '../base/base.adapter';
import type { PartnerAdapter } from '../base/adapter.interface';
import type {
  CreateOrderCommand,
  RescheduleOrderCommand,
} from '../../commands/base/order-command.types';
import { toResultError } from '../../utils/types/integration-result';

/**
 * Orange Health partner adapter.
 * TODO: Implement after verifying Orange Health API documentation.
 */
export class OrangeAdapter extends BasePartnerAdapter implements PartnerAdapter {
  async createOrder(_command: CreateOrderCommand) {
    return toResultError(
      _command.partnerId,
      'Orange Health createOrder not yet implemented'
    );
  }

  async rescheduleOrder(orderId: string, _command: RescheduleOrderCommand) {
    return toResultError(
      orderId,
      'Orange Health rescheduleOrder not yet implemented'
    );
  }

  async cancelOrder(orderId: string) {
    return toResultError(
      orderId,
      'Orange Health cancelOrder not yet implemented'
    );
  }

  async fetchStatus(orderId: string) {
    return toResultError(
      orderId,
      'Orange Health fetchStatus not yet implemented'
    );
  }
}
