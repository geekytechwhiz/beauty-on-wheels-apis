import {
  mergeMetadataAndDocument,
  mergeResolvedTemplateLayer,
  toResolvedTemplate,
  type ResolvedTemplate,
  type TemplateDefinition,
  type TemplateMetadata,
} from '../domain';
import { TemplateNotFoundError, TemplateResolveError } from '../shared';
import type { TemplateRepository } from './template-repository.port';
import type { TemplateDocumentLoader } from './dto';

const MAX_INHERITANCE_DEPTH = 10;

export class TemplateResolver {
  constructor(
    private readonly repository: TemplateRepository,
    private readonly loadDocument: TemplateDocumentLoader,
  ) {}

  async resolve(orgId: string, templateId: string, version?: string): Promise<ResolvedTemplate> {
    const resolvedVersion = version ?? (await this.pickLatestVersion(orgId, templateId));

    if (!resolvedVersion) {
      throw new TemplateNotFoundError(`Template ${templateId} has no versions`);
    }

    return this.resolveChain(orgId, templateId, resolvedVersion, 0, new Set<string>());
  }

  async getRaw(orgId: string, templateId: string, version: string): Promise<TemplateDefinition | null> {
    const metadata = await this.repository.getByKey(orgId, templateId, version);
    if (!metadata) return null;
    const document = await this.loadDocument(metadata);
    return mergeMetadataAndDocument(metadata, document);
  }

  async pickLatestMetadata(orgId: string, templateId: string): Promise<TemplateMetadata | null> {
    const versions = await this.repository.listVersionsForTemplate(orgId, templateId);
    if (versions.length === 0) return null;
    versions.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
    return versions[0] ?? null;
  }

  private async pickLatestVersion(orgId: string, templateId: string): Promise<string | null> {
    const latest = await this.pickLatestMetadata(orgId, templateId);
    return latest?.version ?? null;
  }

  private async resolveChain(
    orgId: string,
    templateId: string,
    version: string,
    depth: number,
    visiting: Set<string>,
  ): Promise<ResolvedTemplate> {
    if (depth > MAX_INHERITANCE_DEPTH) {
      throw new TemplateResolveError('Template inheritance depth exceeded');
    }

    const key = `${orgId}#${templateId}#${version}`;
    if (visiting.has(key)) {
      throw new TemplateResolveError('Template inheritance cycle detected');
    }

    visiting.add(key);

    try {
      const metadata = await this.repository.getByKey(orgId, templateId, version);
      if (!metadata) {
        throw new TemplateNotFoundError(`Template ${templateId}@${version} not found`);
      }

      const document = await this.loadDocument(metadata);
      const definition = mergeMetadataAndDocument(metadata, document);

      if (metadata.baseTemplateId && metadata.baseVersion) {
        const base = await this.resolveChain(
          metadata.baseOrgId ?? metadata.orgId,
          metadata.baseTemplateId,
          metadata.baseVersion,
          depth + 1,
          visiting,
        );
        return mergeResolvedTemplateLayer(base, definition);
      }

      return toResolvedTemplate(definition);
    } finally {
      visiting.delete(key);
    }
  }
}
