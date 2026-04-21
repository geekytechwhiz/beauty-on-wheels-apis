import { CarePlanSectionType, resolveSectionKind } from '../domain/care-plan-section-types';
import { TemplateValidationError } from '../shared/template.errors';

function isCarePlanConfig(config: Record<string, unknown>): boolean {
  return config.templateType === 'CARE_PLAN' || config.profileTemplateType === 'CARE_PLAN';
}

function sectionIdentity(section: Record<string, unknown>, index: number): string {
  const id = section.sectionId;
  if (typeof id === 'string' && id.trim() !== '') {
    return id.trim();
  }
  return `__idx_${index}`;
}

/**
 * Ensures sections: unique order, unique sectionId, and CARE_PLAN mandatory OKR + REVIEW (via sectionType/sectionId).
 */
export function assertCarePlanSections(config: Record<string, unknown>): void {
  const sections = config.sections;
  if (!Array.isArray(sections)) {
    if (isCarePlanConfig(config)) {
      throw new TemplateValidationError(
        'CARE_PLAN template must define a non-empty sections array',
        'TEMPLATE.CARE_PLAN_SECTIONS_REQUIRED',
      );
    }
    return;
  }

  if (sections.length === 0) {
    if (isCarePlanConfig(config)) {
      throw new TemplateValidationError(
        'CARE_PLAN template must define a non-empty sections array',
        'TEMPLATE.CARE_PLAN_SECTIONS_REQUIRED',
      );
    }
    return;
  }

  const orders: number[] = [];
  const ids = new Set<string>();
  let hasOkr = false;
  let hasReview = false;

  for (let i = 0; i < sections.length; i++) {
    const raw = sections[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TemplateValidationError(
        `sections[${i}] must be an object`,
        'TEMPLATE.SECTION_INVALID',
        undefined,
        { index: i },
      );
    }
    const s = raw as Record<string, unknown>;
    const kind = resolveSectionKind(s);
    if (kind === CarePlanSectionType.OKR) {
      hasOkr = true;
    }
    if (kind === CarePlanSectionType.REVIEW) {
      hasReview = true;
    }

    const sid = sectionIdentity(s, i);
    if (ids.has(sid)) {
      throw new TemplateValidationError(
        `Duplicate sectionId: ${sid}`,
        'TEMPLATE.SECTION_DUPLICATE_ID',
        undefined,
        { sectionId: sid },
      );
    }
    ids.add(sid);

    if (typeof s.order === 'number') {
      orders.push(s.order);
    }
  }

  const uniqueOrders = new Set(orders);
  if (orders.length > 0 && uniqueOrders.size !== orders.length) {
    throw new TemplateValidationError('Section order values must be unique', 'TEMPLATE.SECTION_ORDER_UNIQUE');
  }

  if (isCarePlanConfig(config)) {
    if (!hasOkr || !hasReview) {
      throw new TemplateValidationError(
        `CARE_PLAN template must include sections with sectionType or sectionId ${CarePlanSectionType.OKR} and ${CarePlanSectionType.REVIEW}`,
        'TEMPLATE.CARE_PLAN_SECTIONS_OKR_REVIEW',
      );
    }
  }
}
