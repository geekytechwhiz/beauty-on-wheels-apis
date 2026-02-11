/**
 * Stateless integration service.
 * Uses Partner Registry for config, @api-hub/lab-integration for adapters and idempotency.
 * Translates canonical commands → partner APIs and partner responses → canonical results.
 */

import { createAdapter, IdempotencyService } from '@api-hub/lab-integration';
import type {
  CreateOrderCommand,
  RescheduleOrderCommand,
} from '@api-hub/lab-integration';
import type { IntegrationResult } from '@api-hub/lab-integration';
import { getPartnerConfig as getRegistryConfig } from './partnerRegistry.client';
import { mapRegistryConfigToLibConfig } from '../config/partner-config.mapper';

const idempotencyService = new IdempotencyService();

async function getLibConfig(partnerId: string) {
  const registryConfig = await getRegistryConfig(partnerId);
  return mapRegistryConfigToLibConfig(registryConfig);
}

export async function createOrder(
  command: CreateOrderCommand,
  idempotencyKey?: string
): Promise<IntegrationResult> {
  if (idempotencyKey) {
    const cached =
      await idempotencyService.getResult<IntegrationResult>(idempotencyKey);
    if (cached) return cached;
  }

  const config = await getLibConfig(command.partnerId);
  const adapter = createAdapter(config);
  const result = await adapter.createOrder(command);

  if (idempotencyKey) {
    await idempotencyService.storeResult(idempotencyKey, result);
  }
  return result;
}

export async function rescheduleOrder(
  partnerId: string,
  orderId: string,
  command: RescheduleOrderCommand,
  idempotencyKey?: string
): Promise<IntegrationResult> {
  if (idempotencyKey) {
    const cached =
      await idempotencyService.getResult<IntegrationResult>(idempotencyKey);
    if (cached) return cached;
  }

  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  const result = await adapter.rescheduleOrder(orderId, command);

  if (idempotencyKey) {
    await idempotencyService.storeResult(idempotencyKey, result);
  }
  return result;
}

export async function cancelOrder(
  partnerId: string,
  orderId: string,
  remark?: string,
  idempotencyKey?: string
): Promise<IntegrationResult> {
  if (idempotencyKey) {
    const cached =
      await idempotencyService.getResult<IntegrationResult>(idempotencyKey);
    if (cached) return cached;
  }

  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  const result = await adapter.cancelOrder(orderId, remark);

  if (idempotencyKey) {
    await idempotencyService.storeResult(idempotencyKey, result);
  }
  return result;
}

export async function getOrderStatus(
  partnerId: string,
  orderId: string
): Promise<IntegrationResult> {
  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  return adapter.fetchStatus(orderId);
}

export async function getServiceableLocations(
  partnerId: string,
  query: string
): Promise<IntegrationResult> {
  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  if (!adapter.getServiceableLocations) {
    throw new Error(`getServiceableLocations not supported for partner: ${partnerId}`);
  }
  return adapter.getServiceableLocations(query);
}

export async function getPartnerLocation(
  partnerId: string,
  eloc: string
): Promise<IntegrationResult> {
  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  if (!adapter.getPartnerLocation) {
    throw new Error(`getPartnerLocation not supported for partner: ${partnerId}`);
  }
  return adapter.getPartnerLocation(eloc);
}

export async function searchPackages(
  partnerId: string,
  query: string
): Promise<IntegrationResult> {
  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  if (!adapter.searchPackages) {
    throw new Error(`searchPackages not supported for partner: ${partnerId}`);
  }
  return adapter.searchPackages(query);
}

export async function getPackageDetails(
  partnerId: string,
  code: string
): Promise<IntegrationResult> {
  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  if (!adapter.getPackageDetails) {
    throw new Error(`getPackageDetails not supported for partner: ${partnerId}`);
  }
  return adapter.getPackageDetails(code);
}

export async function getBookingSlots(
  partnerId: string,
  params: {
    latitude: number;
    longitude: number;
    collectionDate: string;
  }
): Promise<IntegrationResult> {
  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  if (!adapter.getBookingSlots) {
    throw new Error(`getBookingSlots not supported for partner: ${partnerId}`);
  }
  return adapter.getBookingSlots(params);
}

export async function confirmBooking(
  partnerId: string,
  orderId: string,
  remark?: string,
  idempotencyKey?: string
): Promise<IntegrationResult> {
  if (idempotencyKey) {
    const cached =
      await idempotencyService.getResult<IntegrationResult>(idempotencyKey);
    if (cached) return cached;
  }

  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  if (!adapter.confirmBooking) {
    throw new Error(`confirmBooking not supported for partner: ${partnerId}`);
  }
  const result = await adapter.confirmBooking(orderId, remark);

  if (idempotencyKey) {
    await idempotencyService.storeResult(idempotencyKey, result);
  }
  return result;
}

export async function updatePackage(
  partnerId: string,
  packageCode: string,
  updateData: Record<string, unknown>,
  idempotencyKey?: string
): Promise<IntegrationResult> {
  if (idempotencyKey) {
    const cached =
      await idempotencyService.getResult<IntegrationResult>(idempotencyKey);
    if (cached) return cached;
  }

  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  if (!adapter.updatePackage) {
    throw new Error(`updatePackage not supported for partner: ${partnerId}`);
  }
  const result = await adapter.updatePackage(packageCode, updateData);

  if (idempotencyKey) {
    await idempotencyService.storeResult(idempotencyKey, result);
  }
  return result;
}

export async function getConsolidatedReport(
  partnerId: string,
  orderId: string
): Promise<IntegrationResult> {
  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  if (!adapter.getConsolidatedReport) {
    throw new Error(`getConsolidatedReport not supported for partner: ${partnerId}`);
  }
  return adapter.getConsolidatedReport(orderId);
}

export async function getDigitalReport(
  partnerId: string,
  orderId: string,
  format?: string
): Promise<IntegrationResult> {
  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  if (!adapter.getDigitalReport) {
    throw new Error(`getDigitalReport not supported for partner: ${partnerId}`);
  }
  return adapter.getDigitalReport(orderId, format);
}

export async function updateCredit(
  partnerId: string,
  orderId: string,
  creditData: Record<string, unknown>,
  idempotencyKey?: string
): Promise<IntegrationResult> {
  if (idempotencyKey) {
    const cached =
      await idempotencyService.getResult<IntegrationResult>(idempotencyKey);
    if (cached) return cached;
  }

  const config = await getLibConfig(partnerId);
  const adapter = createAdapter(config);
  if (!adapter.updateCredit) {
    throw new Error(`updateCredit not supported for partner: ${partnerId}`);
  }
  const result = await adapter.updateCredit(orderId, creditData);

  if (idempotencyKey) {
    await idempotencyService.storeResult(idempotencyKey, result);
  }
  return result;
}