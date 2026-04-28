/**
 * Canonical lifecycle statuses (healthcare template service).
 * Legacy values stored in Dynamo are normalized on read.
 */
export type TemplateLifecycleStatus = 'SAVED' | 'IN_REVIEW' | 'PUBLISHED' | 'INACTIVE';

const LEGACY_MAP: Record<string, TemplateLifecycleStatus> = {
  draft: 'SAVED',
  published: 'PUBLISHED',
  archived: 'INACTIVE',
};

export function normalizeTemplateStatus(raw: string | undefined): TemplateLifecycleStatus {
  if (!raw) return 'SAVED';
  if (raw in LEGACY_MAP) {
    return LEGACY_MAP[raw];
  }
  if (raw === 'SAVED' || raw === 'IN_REVIEW' || raw === 'PUBLISHED' || raw === 'INACTIVE') {
    return raw;
  }
  return 'SAVED';
}

export function serializeTemplateStatus(status: TemplateLifecycleStatus): string {
  return status;
}
