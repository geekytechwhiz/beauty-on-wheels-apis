import { createHash } from 'crypto';

/**
 * Profile dimensions for single-published enforcement (per org).
 */
export interface TemplateProfileDimensions {
  /** Domain template kind, e.g. CARE_PLAN, OKR (distinct from MASTER | ORG storage type). */
  profileTemplateType: string;
  category: string;
  condition: string;
  country: string;
}

export function normalizeProfilePart(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Stable key for Dynamo GSI: org-scoped profile identity.
 */
export function buildProfileKey(orgId: string, profile: TemplateProfileDimensions): string {
  const parts = [
    normalizeProfilePart(profile.profileTemplateType),
    normalizeProfilePart(profile.category),
    normalizeProfilePart(profile.condition),
    normalizeProfilePart(profile.country),
  ];
  const joined = parts.join('|');
  const hash = createHash('sha256').update(joined).digest('hex').slice(0, 32);
  return `${orgId}#${hash}`;
}
