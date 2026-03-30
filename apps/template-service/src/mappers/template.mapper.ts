import type { TemplateDefinition } from '@api-hub/template-core';

/** API projection (currently 1:1 with domain). */
export function templateToResponse(t: TemplateDefinition): TemplateDefinition {
  return { ...t };
}
