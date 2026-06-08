import fs from 'fs';

import seedCatalogJson from '../change-policy-rules.seed.json';
import type { ChangePolicyCatalog } from '../types/change-policy.types';
import { ChangePolicyCatalogError, parseChangePolicyCatalog } from './change-policy-catalog.schema';

function loadSeedJsonFromPath(seedPath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ChangePolicyCatalogError(`Unable to read change policy seed at ${seedPath}: ${message}`);
  }
}

/** Loads and validates the platform seed catalog. */
export function loadChangePolicyCatalogFromFile(seedPath?: string): ChangePolicyCatalog {
  const raw = seedPath ? loadSeedJsonFromPath(seedPath) : seedCatalogJson;
  return parseChangePolicyCatalog(raw);
}

let cachedCatalog: ChangePolicyCatalog | null = null;

/** Lazy singleton for internal evaluation (not exposed via HTTP). */
export function getChangePolicyCatalog(): ChangePolicyCatalog {
  if (!cachedCatalog) {
    cachedCatalog = loadChangePolicyCatalogFromFile();
  }
  return cachedCatalog;
}

/** Test-only reset. */
export function resetChangePolicyCatalogCache(): void {
  cachedCatalog = null;
}
