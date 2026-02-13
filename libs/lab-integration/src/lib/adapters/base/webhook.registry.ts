import type { LabWebhookAdapter } from './webhook.types';
import { RedcliffeWebhookAdapter } from '../redcliffe/redcliffe.webhook';
import { OrangeWebhookAdapter } from '../orange/orange.webhook';

const registry = new Map<string, LabWebhookAdapter>([
  ['redcliffe', new RedcliffeWebhookAdapter()],
  ['orange', new OrangeWebhookAdapter()],
  ['orangehealth', new OrangeWebhookAdapter()],
]);

/**
 * Get webhook adapter for the given adapter key (from partner config).
 * @param adapterKey - Partner adapter key (e.g. redcliffe, orange, orangehealth)
 * @returns LabWebhookAdapter instance
 * @throws Error if no adapter is registered for the key
 */
export function createWebhookAdapter(adapterKey: string): LabWebhookAdapter {
  const key = adapterKey?.toLowerCase().trim() ?? '';
  const adapter = registry.get(key);
  if (!adapter) {
    throw new Error(
      `No webhook adapter registered for key: ${adapterKey}. ` +
        `Available: ${Array.from(registry.keys()).join(', ')}`
    );
  }
  return adapter;
}
