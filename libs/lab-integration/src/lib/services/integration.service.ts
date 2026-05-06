import { createAdapter } from '../adapters/base/adapter.factory';
import { getPartnerConfig } from './partner-config.service';
import { IdempotencyService } from './idempotency.service';
import type {
  CreateOrderCommand,
  RescheduleOrderCommand,
} from '../commands/base/order-command.types';
import type { IntegrationResult } from '../utils/types/integration-result';

const idempotencyService = new IdempotencyService();

/**
 * Create a new order with idempotency support.
 */
export async function createOrder(
  command: CreateOrderCommand,
  idempotencyKey?: string
): Promise<IntegrationResult> {
  if (idempotencyKey) {
    const cached =
      await idempotencyService.getResult<IntegrationResult>(idempotencyKey);
    if (cached) {
      // console.log(
        // `Returning cached result for idempotency key: ${idempotencyKey}`
      // );
      return cached;
    }
  }

  const config = await getPartnerConfig(command.partnerId);
  const adapter = createAdapter(config);
  const result = await adapter.createOrder(command);

  if (idempotencyKey) {
    await idempotencyService.storeResult(idempotencyKey, result);
  }

  return result;
}

/**
 * Reschedule an existing order with idempotency support.
 */
export async function rescheduleOrder(
  partnerId: string,
  orderId: string,
  command: RescheduleOrderCommand,
  idempotencyKey?: string
): Promise<IntegrationResult> {
  if (idempotencyKey) {
    const cached =
      await idempotencyService.getResult<IntegrationResult>(idempotencyKey);
    if (cached) {
      // console.log(
        // `Returning cached result for idempotency key: ${idempotencyKey}`
      // );
      return cached;
    }
  }

  const config = await getPartnerConfig(partnerId);
  const adapter = createAdapter(config);
  const result = await adapter.rescheduleOrder(orderId, command);

  if (idempotencyKey) {
    await idempotencyService.storeResult(idempotencyKey, result);
  }

  return result;
}

/**
 * Cancel an existing order.
 */
export async function cancelOrder(
  partnerId: string,
  orderId: string,
  remark?: string,
  idempotencyKey?: string
): Promise<IntegrationResult> {
  if (idempotencyKey) {
    const cached =
      await idempotencyService.getResult<IntegrationResult>(idempotencyKey);
    if (cached) {
      // console.log(
        // `Returning cached result for idempotency key: ${idempotencyKey}`
      // );
      return cached;
    }
  }

  const config = await getPartnerConfig(partnerId);
  const adapter = createAdapter(config);
  const result = await adapter.cancelOrder(orderId, remark);

  if (idempotencyKey) {
    await idempotencyService.storeResult(idempotencyKey, result);
  }

  return result;
}

/**
 * Get order status (no idempotency needed for reads).
 */
export async function getOrderStatus(
  partnerId: string,
  orderId: string
): Promise<IntegrationResult> {
  const config = await getPartnerConfig(partnerId);
  const adapter = createAdapter(config);
  return adapter.fetchStatus(orderId);
}
