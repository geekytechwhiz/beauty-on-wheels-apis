import type { ResolvedTemplate, TemplateDefinition, TemplateDocument, TemplateMetadata } from '../types';
import type { TemplateMetadataStore } from '../template-metadata-store.port';
import { mergeMetadataAndDocument, mergeResolvedLayer, toResolved } from './merge-templates';

const MAX_INHERITANCE_DEPTH = 10;

export type TemplateDocumentLoader = (meta: TemplateMetadata) => Promise<TemplateDocument>;

export class TemplateResolver {
  constructor(
    private readonly store: TemplateMetadataStore,
    private readonly loadDocument: TemplateDocumentLoader,
  ) {}

  /**
   * Resolve latest version (by updatedAt) when version is omitted.
   */
  async resolve(
    orgId: string,
    templateId: string,
    version?: string,
  ): Promise<ResolvedTemplate> {
    const v =
      version ??
      (await this.pickLatestVersion(orgId, templateId));

    if (!v) {
      throw new Error(`TEMPLATE_NOT_FOUND: ${templateId} has no versions`);
    }

    return this.resolveChain(orgId, templateId, v, 0, new Set());
  }

  private async pickLatestVersion(orgId: string, templateId: string): Promise<string | null> {
    const all = await this.store.listVersionsForTemplate(orgId, templateId);
    if (all.length === 0) return null;
    all.sort((a: TemplateMetadata, b: TemplateMetadata) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return all[0]?.version ?? null;
  }

  private async resolveChain(
    orgId: string,
    templateId: string,
    version: string,
    depth: number,
    visiting: Set<string>,
  ): Promise<ResolvedTemplate> {
    if (depth > MAX_INHERITANCE_DEPTH) {
      throw new Error('TEMPLATE_INHERITANCE_DEPTH_EXCEEDED');
    }

    const key = `${orgId}#${templateId}#${version}`;
    if (visiting.has(key)) {
      throw new Error('TEMPLATE_INHERITANCE_CYCLE');
    }
    visiting.add(key);

    try {
      const meta = await this.store.getByKey(orgId, templateId, version);
      if (!meta) {
        throw new Error(`TEMPLATE_NOT_FOUND: ${templateId}@${version}`);
      }
      const doc = await this.loadDocument(meta);
      const t = mergeMetadataAndDocument(meta, doc);

      if (meta.baseTemplateId && meta.baseVersion) {
        const baseOrgId = meta.baseOrgId ?? meta.orgId;
        const base = await this.resolveChain(
          baseOrgId,
          meta.baseTemplateId,
          meta.baseVersion,
          depth + 1,
          visiting,
        );
        return mergeResolvedLayer(base, t);
      }
      return toResolved(t);
    } finally {
      visiting.delete(key);
    }
  }

  /** Load a single version without merging (admin/debug). */
  async getRaw(orgId: string, templateId: string, version: string): Promise<TemplateDefinition | null> {
    const meta = await this.store.getByKey(orgId, templateId, version);
    if (!meta) return null;
    const doc = await this.loadDocument(meta);
    return mergeMetadataAndDocument(meta, doc);
  }
}
