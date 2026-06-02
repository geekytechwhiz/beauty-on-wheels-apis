import * as configs from '../generated/resource-config/R4/index.js';
import { resourceRegistry } from '../registry/resource-registry';
import { ResourceConfig } from '../types/resource.types';

export function bootstrapRegistry() {
  Object.values(configs).forEach((config) => {
    resourceRegistry.register(config as unknown as ResourceConfig);
  });
}
