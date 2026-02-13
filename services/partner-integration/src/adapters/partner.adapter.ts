/**
 * Partner config types returned by Partner Registry (read-only).
 * Adapter implementation and contract live in @api-hub/lab-integration.
 */

/** Auth config from registry (matches @api-hub/partners PartnerAuthConfig). */
export interface PartnerAuthConfig {
  authType: 'API_KEY' | 'BEARER' | 'OAUTH_CLIENT_CREDENTIALS';
  credentialsSecretArn: string;
  oauthTokenUrl?: string;
}

/**
 * Partner config from Partner Registry.
 * Mapped to lib PartnerConfig in config/partner-config.mapper.ts.
 */
export interface PartnerConfig {
  partnerId: string;
  apiBaseUrl: string;
  authConfig?: PartnerAuthConfig;
  adapterKey?: string;
}
