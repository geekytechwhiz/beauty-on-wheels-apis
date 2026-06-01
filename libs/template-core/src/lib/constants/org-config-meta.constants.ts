/** Org enablement UI config keys stored in `services-json`. */
export const ORG_CONFIG_META_KEYS = [
  'ORG_DRAWER',
  'ORG_MANAGEABILITY',
  'ENABLE_SCOPE',
] as const;

export type OrgConfigMetaKey = (typeof ORG_CONFIG_META_KEYS)[number];

export const ORG_CONFIG_META_FILE: Record<OrgConfigMetaKey, string> = {
  ORG_DRAWER: 'org-drawer.json',
  ORG_MANAGEABILITY: 'org-manageibility.json',
  ENABLE_SCOPE: 'enable-scope.json',
};

const KEY_ALIASES: Record<string, OrgConfigMetaKey> = {
  ORG_DRAWER: 'ORG_DRAWER',
  ORG_MANAGEABILITY: 'ORG_MANAGEABILITY',
  ORG_MANAGEIBILITY: 'ORG_MANAGEABILITY',
  ENABLE_SCOPE: 'ENABLE_SCOPE',
};

export function normalizeOrgConfigMetaKey(raw: string): OrgConfigMetaKey | undefined {
  const key = raw.trim().toUpperCase().replace(/-/g, '_');
  return KEY_ALIASES[key];
}
