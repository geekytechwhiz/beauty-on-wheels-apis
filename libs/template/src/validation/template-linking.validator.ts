import { TemplateValidationError } from '../shared/template.errors';

export type ResolvePublishedMeta = (orgId: string, templateId: string) => Promise<{
  version: string;
  status: string;
} | null>;

function isPublishedStatus(status: string): boolean {
  return status === 'PUBLISHED' || status === 'published';
}

function walkForLinkedTemplateIds(value: unknown, out: string[]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v) => walkForLinkedTemplateIds(v, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/templateversionid$/i.test(k) && typeof v === 'string' && v.trim() !== '') {
        out.push(v.trim());
      } else {
        walkForLinkedTemplateIds(v, out);
      }
    }
  }
}

function collectLinkedTemplateIds(config: Record<string, unknown>): string[] {
  const out: string[] = [];
  walkForLinkedTemplateIds(config, out);
  return [...new Set(out)];
}

/**
 * Template service scope: linked template IDs must resolve to a PUBLISHED row (org or master org).
 */
export async function assertPublishedLinkTargets(
  config: Record<string, unknown>,
  resolvePublished: ResolvePublishedMeta,
  orgId: string,
): Promise<void> {
  const ids = collectLinkedTemplateIds(config);
  for (const tid of ids) {
    const meta = await resolvePublished(orgId, tid);
    if (!meta || !isPublishedStatus(meta.status)) {
      throw new TemplateValidationError(
        `Link target ${tid} must be a PUBLISHED template`,
        'TEMPLATE.LINK_NOT_PUBLISHED',
        undefined,
        { templateId: tid },
      );
    }
  }
}
