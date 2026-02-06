import type { CreateLabOrderCommand } from '../models/labOrder.command';
import type { LabIntegrationResult } from '../models/labIntegration.result';

/** Auth config from registry (matches @api-hub/partners PartnerAuthConfig). */
export interface PartnerAuthConfig {
  authType: 'API_KEY' | 'BEARER' | 'OAUTH_CLIENT_CREDENTIALS';
  credentialsSecretArn: string;
  oauthTokenUrl?: string;
}

/**
 * Partner config passed to adapters (read-only from Partner Registry).
 * Auth resolved at runtime via authConfig.credentialsSecretArn (registry-driven) or env fallback.
 */
export interface LabPartnerConfig {
  partnerId: string;
  apiBaseUrl: string;
  /** Registry-driven auth (G1/A1/A3). If set, adapters use this; else fallback to env per partnerId. */
  authConfig?: PartnerAuthConfig;
  /** Adapter key for registry-driven adapter selection (G4), e.g. "redcliffe", "orange". */
  adapterKey?: string;
}

/**
 * Strict adapter contract for lab partners.
 * Each adapter handles: auth headers, endpoint URLs, payload mapping, error translation.
 */
export interface LabPartnerAdapter {
  createOrder(command: CreateLabOrderCommand): Promise<LabIntegrationResult>;
  cancelOrder(orderId: string): Promise<LabIntegrationResult>;
  fetchStatus(orderId: string): Promise<LabIntegrationResult>;
}
