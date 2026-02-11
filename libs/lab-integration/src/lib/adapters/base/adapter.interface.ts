import type {
  CreateOrderCommand,
  RescheduleOrderCommand,
} from '../../commands/base/order-command.types';
import type { IntegrationResult } from '../../utils/types/integration-result';

export interface BookingSlotsParams {
  latitude: number;
  longitude: number;
  collectionDate: string;
}

/**
 * Standard interface all partner adapters must implement.
 */
export interface PartnerAdapter {
  createOrder(command: CreateOrderCommand): Promise<IntegrationResult>;
  rescheduleOrder(
    orderId: string,
    command: RescheduleOrderCommand
  ): Promise<IntegrationResult>;
  cancelOrder(orderId: string, remark?: string): Promise<IntegrationResult>;
  fetchStatus(orderId: string): Promise<IntegrationResult>;

  // Phase 2 methods
  getServiceableLocations?(query: string): Promise<IntegrationResult>;
  getPartnerLocation?(eloc: string): Promise<IntegrationResult>;
  searchPackages?(query: string): Promise<IntegrationResult>;
  getPackageDetails?(code: string): Promise<IntegrationResult>;
  getBookingSlots?(params: BookingSlotsParams): Promise<IntegrationResult>;

  // Phase 3 methods
  confirmBooking?(orderId: string, remark?: string): Promise<IntegrationResult>;
  updatePackage?(packageCode: string, updateData: Record<string, unknown>): Promise<IntegrationResult>;
  getConsolidatedReport?(orderId: string): Promise<IntegrationResult>;
  getDigitalReport?(orderId: string, format?: string): Promise<IntegrationResult>;
}

/**
 * Configuration interface for partner adapters.
 */
export interface PartnerConfig {
  partnerId: string;
  partnerName: string;
  adapterKey: string; // Used to resolve adapter from registry
  baseUrl: string;
  authConfig?: {
    credentialsSecretArn: string;
  };
  timeout?: number;
  circuitBreaker?: {
    enabled: boolean;
    failureThreshold?: number;
    resetTimeoutMs?: number;
  };
}

/**
 * Constructor type for partner adapters.
 */
export type AdapterConstructor = new (config: PartnerConfig) => PartnerAdapter;
