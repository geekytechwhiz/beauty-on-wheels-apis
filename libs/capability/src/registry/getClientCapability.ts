/**
 * Capability registry — returns CapabilityStatement per client.
 * Cached per clientId; default to safe minimal support.
 */

export interface CapabilityStatement {
  resourceType: 'CapabilityStatement';
  status: string;
  date: string;
  kind: string;
  software?: { name: string; version?: string };
  implementation?: { description: string; url?: string };
  fhirVersion: string;
  format: string[];
  rest?: Array<{
    mode: string;
    resource?: Array<{
      type: string;
      interaction?: Array<{ code: string }>;
      readHistory?: boolean;
      searchParam?: unknown[];
    }>;
  }>;
}

const defaultCapability: CapabilityStatement = {
  resourceType: 'CapabilityStatement',
  status: 'active',
  date: new Date().toISOString().slice(0, 10),
  kind: 'instance',
  fhirVersion: '4.0.1',
  format: ['application/fhir+json'],
  rest: [
    {
      mode: 'server',
      resource: [
        { type: 'Patient', interaction: [{ code: 'read' }] },
        { type: 'Observation', interaction: [{ code: 'read' }, { code: 'search-type' }] },
      ],
    },
  ],
};

const cache = new Map<string, { statement: CapabilityStatement; until: number }>();
const CACHE_TTL_MS = 60_000;

/**
 * Returns CapabilityStatement for the given client.
 * Cached per clientId; defaults to safe minimal support.
 */
export function getClientCapability(clientId: string): CapabilityStatement {
  const now = Date.now();
  const entry = cache.get(clientId);
  if (entry && entry.until > now) {
    return entry.statement;
  }
  const statement: CapabilityStatement = {
    ...defaultCapability,
    implementation: {
      description: `FHIR Gateway for client ${clientId}`,
    },
  };
  cache.set(clientId, { statement, until: now + CACHE_TTL_MS });
  return statement;
}
