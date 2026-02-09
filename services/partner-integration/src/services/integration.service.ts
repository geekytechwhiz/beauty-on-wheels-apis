/**
 * Stateless integration service.
 * Translates canonical commands → partner APIs and partner responses → canonical results.
 * No database access, no persistence, no business rules.
 */

import type { CreateOrderCommand } from '../models/order.command';
import type { IntegrationResult } from '../models/integration.result';
import { getAdapter } from '../factories/adapter.factory';
import { getPartnerConfig } from './partnerRegistry.client';

export async function createOrder(command: CreateOrderCommand): Promise<IntegrationResult> {
  const config = await getPartnerConfig(command.partnerId);
  const adapter = getAdapter(command.partnerId, config);
  return adapter.createOrder(command);
}

export async function cancelOrder(partnerId: string, orderId: string): Promise<IntegrationResult> {
  const config = await getPartnerConfig(partnerId);
  const adapter = getAdapter(partnerId, config);
  return adapter.cancelOrder(orderId);
}

export async function getOrderStatus(partnerId: string, orderId: string): Promise<IntegrationResult> {
  const config = await getPartnerConfig(partnerId);
  const adapter = getAdapter(partnerId, config);
  return adapter.fetchStatus(orderId);
}
