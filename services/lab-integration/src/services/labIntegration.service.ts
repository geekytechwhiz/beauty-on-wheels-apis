/**
 * Stateless lab integration service.
 * Translates canonical commands → partner APIs and partner responses → canonical results.
 * No database access, no persistence, no business rules.
 */

import type { CreateLabOrderCommand } from '../models/labOrder.command';
import type { LabIntegrationResult } from '../models/labIntegration.result';
import { getLabAdapter } from '../factories/adapter.factory';
import { getPartnerConfig } from './partnerRegistry.client';

export async function createLabOrder(command: CreateLabOrderCommand): Promise<LabIntegrationResult> {
  const config = await getPartnerConfig(command.partnerId);
  const adapter = getLabAdapter(command.partnerId, config);
  return adapter.createOrder(command);
}

export async function cancelLabOrder(partnerId: string, orderId: string): Promise<LabIntegrationResult> {
  const config = await getPartnerConfig(partnerId);
  const adapter = getLabAdapter(partnerId, config);
  return adapter.cancelOrder(orderId);
}

export async function getLabOrderStatus(partnerId: string, orderId: string): Promise<LabIntegrationResult> {
  const config = await getPartnerConfig(partnerId);
  const adapter = getLabAdapter(partnerId, config);
  return adapter.fetchStatus(orderId);
}
