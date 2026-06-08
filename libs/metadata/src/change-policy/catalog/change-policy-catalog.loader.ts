import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

import type { ChangePolicyCatalog } from '../types/change-policy.types';
import { ChangePolicyCatalogError, parseChangePolicyCatalog } from './change-policy-catalog.schema';

const requireJson = createRequire(__filename);
const SEED_FILE = 'change-policy-rules.seed.json';

function loadSeedJson(seedPath?: string): unknown {
  if (seedPath) {
    try {
      return JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ChangePolicyCatalogError(`Unable to read change policy seed at ${seedPath}: ${message}`);
    }
  }
  try {
    return requireJson(path.join(__dirname, '..', SEED_FILE));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ChangePolicyCatalogError(`Unable to load bundled change policy seed: ${message}`);
  }
}

/** Loads and validates the platform seed catalog. */
export function loadChangePolicyCatalogFromFile(seedPath?: string): ChangePolicyCatalog {
  return parseChangePolicyCatalog(loadSeedJson(seedPath));
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
