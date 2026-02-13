import type { PartnerAdapter, PartnerConfig } from './adapter.interface';
import { adapterRegistry } from './adapter.registry';

/**
 * Factory function to create partner adapters.
 * Uses registry pattern - no need to modify this file when adding new partners.
 *
 * @param config - Partner configuration including adapterKey
 * @returns Instantiated partner adapter
 * @throws Error if adapter not registered for the given key
 */
export function createAdapter(config: PartnerConfig): PartnerAdapter {
  const { adapterKey } = config;

  if (!adapterKey) {
    throw new Error('Partner configuration missing adapterKey');
  }

  const AdapterConstructor = adapterRegistry.getConstructor(adapterKey);
  return new AdapterConstructor(config);
}

/**
 * Get available adapter keys.
 */
export function getAvailableAdapters(): string[] {
  return adapterRegistry.getRegisteredKeys();
}
