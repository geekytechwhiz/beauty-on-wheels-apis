import type { ServiceRegistryEntry } from '../config/services';

export interface RegisterServiceInput {
  name: string;
  url: string;
  version?: string;
  module?: string;
  rules?: string[];
}

let registryState: ServiceRegistryEntry[] = [];
let initialized = false;

export function bootstrapRegistry(entries: ServiceRegistryEntry[]): void {
  registryState = entries;
  initialized = true;
}

export function isRegistryInitialized(): boolean {
  return initialized;
}

export function listServices(): ServiceRegistryEntry[] {
  return registryState;
}

export function findService(name: string): ServiceRegistryEntry | undefined {
  return registryState.find((entry) => entry.name === name);
}

export function resolveServiceUrl(name: string, requestedVersion?: string): string | undefined {
  const service = findService(name);
  if (!service) return undefined;
  const version = requestedVersion || service.latest;
  return service.versions[version]?.url;
}

export function registerService(input: RegisterServiceInput): ServiceRegistryEntry {
  const version = input.version ?? 'v1';
  const existing = findService(input.name);
  if (existing) {
    existing.versions[version] = { url: input.url };
    existing.latest = version;
    if (input.module) existing.module = input.module;
    if (input.rules) existing.rules = input.rules;
    return existing;
  }

  const created: ServiceRegistryEntry = {
    name: input.name,
    latest: version,
    versions: { [version]: { url: input.url } },
    module: input.module,
    rules: input.rules,
  };
  registryState.push(created);
  return created;
}
