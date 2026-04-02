import {
  mergeMetadataAndDocument,
  mergeResolvedTemplateLayer,
  toResolvedTemplate,
  type ResolvedTemplate,
  type TemplateDefinition,
  type TemplateMetadata,
} from '../domain';
import { normalizeTemplateStatus } from '../domain/template-status';
import { TemplateNotFoundError, TemplateNotPublishedError, TemplateResolveError } from '../shared';
import type { TemplateRepository } from './template-repository.port';
import type { TemplateDocumentLoader } from './dto';

const MAX_INHERITANCE_DEPTH = 10;

export class TemplateResolver {
  constructor(
    private readonly repository: TemplateRepository,
    private readonly loadDocument: TemplateDocumentLoader,
  ) {}

  /**
   * Resolves the template chain (base → … → leaf) for **execution** semantics.
   * Always uses the **published** template version only (never “latest” draft).
   */
  async resolve(orgId: string, templateId: string, version?: string): Promise<ResolvedTemplate> {
    const published = await this.repository.getPublishedVersion(orgId, templateId);
    if (!published) {
      throw new TemplateNotPublishedError(
        `No published template '${templateId}' for org '${orgId}'`,
      );
    }
    if (version && published.version !== version) {
      throw new TemplateResolveError(
        `Requested version '${version}' does not match published version '${published.version}'`,
      );
    }

    return this.resolveChain(orgId, templateId, published.version, 0, new Set<string>());
  }

  async getRaw(orgId: string, templateId: string, version: string): Promise<TemplateDefinition | null> {
    const metadata = await this.repository.getByKey(orgId, templateId, version);
    if (!metadata) return null;
    const document = await this.loadDocument(metadata);
    return mergeMetadataAndDocument(metadata, document);
  }

  async pickLatestMetadata(orgId: string, templateId: string): Promise<TemplateMetadata | null> {
    return this.repository.getLatestVersion(orgId, templateId);
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
        if (depth > 0) {
          throw new TemplateNotFoundError(
            `Base template '${templateId}' @ '${version}' not found under org '${orgId}'. ` +
              `Create the MASTER template first (e.g. POST /templates with type MASTER for this id/version), ` +
              `or fix extendsTemplateId, extendsVersion, and extendsBaseOrgId on the child template.`,
          );
        }
        throw new TemplateNotFoundError(
          `Template '${templateId}' @ '${version}' not found under org '${orgId}'`,
        );
      }

      if (normalizeTemplateStatus(metadata.status) !== 'PUBLISHED') {
        throw new TemplateNotPublishedError(
          `Template '${templateId}' @ '${version}' must be PUBLISHED to participate in resolution`,
        );
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
