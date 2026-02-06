import type { LabPartnerAdapter } from '../adapters/labPartner.adapter';
import type { LabPartnerConfig } from '../adapters/labPartner.adapter';
import { RedcliffeAdapter } from '../adapters/redcliffe.adapter';
import { OrangeAdapter } from '../adapters/orange.adapter';
import { UnsupportedPartnerError } from '../utils/integrationErrors';

/** Registry-driven adapter keys (G4). New partners of these types need no code deploy. */
const ADAPTER_KEY_ALLOWLIST = ['redcliffe', 'orange'] as const;
type AdapterKey = (typeof ADAPTER_KEY_ALLOWLIST)[number];

function normalizeKey(key: string): string {
  return key.toLowerCase().trim();
}

function isAllowedAdapterKey(key: string): key is AdapterKey {
  return ADAPTER_KEY_ALLOWLIST.includes(normalizeKey(key) as AdapterKey);
}

/**
 * Resolves the lab partner adapter from registry config (G4).
 * Uses config.adapterKey when set; otherwise falls back to partnerId for backward compatibility.
 */
export function getLabAdapter(partnerId: string, config: LabPartnerConfig): LabPartnerAdapter {
  const key = config.adapterKey ? normalizeKey(config.adapterKey) : normalizeKey(partnerId);
  if (!isAllowedAdapterKey(key)) {
    throw new UnsupportedPartnerError(
      partnerId,
      config.adapterKey ? `Unsupported adapterKey: ${config.adapterKey}` : undefined
    );
  }
  if (key === 'redcliffe') {
    return new RedcliffeAdapter(config);
  }
  return new OrangeAdapter(config);
}
