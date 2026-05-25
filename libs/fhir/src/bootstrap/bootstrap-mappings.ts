import { mappingRegistry } from '../registry/mapping.registry';

import * as configs from '../generated/resource-config/R4';

export async function bootstrapMappings() {
  for (const config of Object.values(configs)) {
    if (!config.mapping?.file) continue;

    const mapping = await import(`../generated/templates/R4/${config.mapping.file}`);

    mappingRegistry.register(mapping.default);
  }
}
