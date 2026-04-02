import type { TemplateProfileDimensions } from '../domain/template-profile';
import type { MetadataApplicabilityContext } from '../domain/metadata-definition.types';

export function buildMetadataApplicabilityContext(input: {
  profile?: TemplateProfileDimensions;
  config: Record<string, unknown>;
}): MetadataApplicabilityContext {
  const fromConfig =
    typeof input.config.templateType === 'string' && input.config.templateType.trim() !== ''
      ? input.config.templateType.trim()
      : '';
  const fromProfileType =
    typeof input.config.profileTemplateType === 'string' && input.config.profileTemplateType.trim() !== ''
      ? input.config.profileTemplateType.trim()
      : '';
  const fromProfile = input.profile?.profileTemplateType?.trim() ?? '';
  const templateType = fromConfig || fromProfileType || fromProfile || '';

  return {
    templateType,
    category: input.profile?.category?.trim() ?? '',
    condition: input.profile?.condition?.trim() ?? '',
    country: input.profile?.country?.trim() ?? '',
  };
}
