import type { MetadataApplicabilityContext } from '../domain/metadata-definition.types';
import type { TemplateProfileDimensions } from '../domain/template-profile';
import type { TemplateDocument } from '../domain/template.types';
import type { MetadataRepository } from '../application/metadata-repository.port';
import type { TemplateRepository } from '../application/template-repository.port';
import { TEMPLATE_MASTER_ORG_ID } from '../policies';
import { assertCarePlanSections } from './template-sections.validator';
import { assertPublishedLinkTargets } from './template-linking.validator';
import { assertSafeTemplateRuleActions } from './template-rule-actions.validator';
import {
  assertOrgChangesRespectMasterControls,
  validateControlMatrixConfig,
} from './template-controls.validator';

/** Validates `template.config.controlMatrix` shape (authoring-side). */
export function validateControlMatrix(template: { config: Record<string, unknown> }): void {
  validateControlMatrixConfig(template.config);
}
import { validateConfigAgainstApplicableMetadata } from './metadata-field-value.validator';
import { buildMetadataApplicabilityContext } from './metadata-context';

export type ValidationRuleActionScope = 'publish' | 'draft';

export interface ValidateTemplateInput {
  orgId: string;
  document: TemplateDocument;
  /** When omitted, derived from `profile` + `document.config` via {@link buildMetadataApplicabilityContext}. */
  metadataContext?: MetadataApplicabilityContext;
  profile?: TemplateProfileDimensions;
  /** Master document when validating ORG drafts against published master controls. */
  masterDocument?: TemplateDocument | null;
  /** When true, linked template ids must resolve to PUBLISHED rows (publish-time). */
  validatePublishedLinks?: boolean;
  ruleActionScope?: ValidationRuleActionScope;
}

export class ValidationEngine {
  constructor(
    private readonly metadataRepository: MetadataRepository,
    private readonly templateRepository: TemplateRepository,
  ) {}

  /**
   * Full template validation: metadata registry, sections, control matrix shape, optional linking,
   * org vs master controls, and rule actions.
   */
  async validateTemplate(input: ValidateTemplateInput): Promise<void> {
    const config = input.document.config as Record<string, unknown>;
    const metadataContext =
      input.metadataContext ??
      buildMetadataApplicabilityContext({
        profile: input.profile,
        config,
      });

    const applicable = await this.metadataRepository.getApplicableMetadata(metadataContext);
    validateConfigAgainstApplicableMetadata(config, applicable);

    assertCarePlanSections(config);
    validateControlMatrixConfig(config);

    const ruleScope = input.ruleActionScope ?? 'draft';
    assertSafeTemplateRuleActions(
      input.document.rules,
      ruleScope === 'publish' ? { scope: 'publish' } : undefined,
    );

    if (input.masterDocument?.config) {
      assertOrgChangesRespectMasterControls(
        input.masterDocument.config as Record<string, unknown>,
        config,
      );
    }

    if (input.validatePublishedLinks) {
      const resolvePublished = async (orgId: string, templateId: string) => {
        let m = await this.templateRepository.getPublishedVersion(orgId, templateId);
        if (!m) {
          m = await this.templateRepository.getPublishedVersion(TEMPLATE_MASTER_ORG_ID, templateId);
        }
        return m ? { version: m.version, status: m.status } : null;
      };
      await assertPublishedLinkTargets(config, resolvePublished, input.orgId);
    }
  }
}
