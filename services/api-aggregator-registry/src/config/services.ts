import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import bundledServices from '../../config/services.json';

export interface ServiceSeed {
  name: string;
  url: string;
  version?: string;
  module?: string;
  rules?: string[];
}

export interface ServiceVersionRecord {
  url: string;
}

export interface ServiceRegistryEntry {
  name: string;
  latest: string;
  versions: Record<string, ServiceVersionRecord>;
  module?: string;
  rules?: string[];
}

function normalizeServices(input: ServiceSeed[]): ServiceRegistryEntry[] {
  const grouped = new Map<string, ServiceRegistryEntry>();
  for (const item of input) {
    const version = item.version ?? 'v1';
    const existing = grouped.get(item.name);
    if (existing) {
      existing.versions[version] = { url: item.url };
      existing.latest = version;
      if (item.module) existing.module = item.module;
      if (item.rules) existing.rules = item.rules;
      continue;
    }
    grouped.set(item.name, {
      name: item.name,
      latest: version,
      versions: { [version]: { url: item.url } },
      module: item.module,
      rules: item.rules,
    });
  }
  return [...grouped.values()];
}

function parseServiceJson(raw: unknown): ServiceSeed[] {
  if (!Array.isArray(raw)) {
    throw new Error('services config must be an array');
  }
  return raw.map((item) => {
    const x = item as Record<string, unknown>;
    if (typeof x.name !== 'string' || typeof x.url !== 'string') {
      throw new Error('services config item requires string name and url');
    }
    return {
      name: x.name,
      url: x.url,
      version: typeof x.version === 'string' ? x.version : 'v1',
      module: typeof x.module === 'string' ? x.module : undefined,
      rules: Array.isArray(x.rules) ? x.rules.filter((r): r is string => typeof r === 'string') : undefined,
    };
  });
}

async function loadFromGithubRaw(rawUrl: string): Promise<ServiceSeed[]> {
  const response = await axios.get(rawUrl, {
    timeout: 10_000,
    validateStatus: (status) => status >= 200 && status < 300,
  });
  return parseServiceJson(response.data);
}

function loadFromLocalFile(localPath: string): ServiceSeed[] {
  const raw = readFileSync(localPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  return parseServiceJson(parsed);
}

export async function loadInitialRegistry(): Promise<ServiceRegistryEntry[]> {
  const githubRaw = process.env.GITHUB_RAW_URL?.trim();
  if (githubRaw) {
    try {
      const fromGithub = await loadFromGithubRaw(githubRaw);
      return normalizeServices(fromGithub);
    } catch (error) {
      console.error('Failed to load services from GITHUB_RAW_URL, using local config fallback', error);
    }
  }

  const explicitPath = process.env.SERVICES_CONFIG_PATH?.trim();
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`SERVICES_CONFIG_PATH does not exist: ${explicitPath}`);
    }
    return normalizeServices(loadFromLocalFile(explicitPath));
  }

  const defaultOnDisk = path.join(process.cwd(), 'config', 'services.json');
  if (existsSync(defaultOnDisk)) {
    return normalizeServices(loadFromLocalFile(defaultOnDisk));
  }

  // Lambda zip often omits loose files unless listed in package.patterns; esbuild bundles this import.
  console.warn(
    `No services file at ${defaultOnDisk}; using bundled config/services.json (safe default in Lambda).`,
  );
  return normalizeServices(parseServiceJson(bundledServices as unknown));
}
