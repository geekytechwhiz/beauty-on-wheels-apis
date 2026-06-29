import type { TemplateStatus } from '../../constants/template.constants';
import type { TemplateActorUser } from '../template-actor.model';
import type { TemplateRulesPatch } from '../../utils/template-rules.utils';

export type GetOrgTemplateRulesParams = {
  masterTemplateId: string;
  organizationId: string;
};

export type UpdateOrgTemplateRulesParams = {
  masterTemplateId: string;
  organizationId: string;
  rules?: TemplateRulesPatch;
  fieldValues?: Record<string, unknown>;
  status?: TemplateStatus;
  active?: boolean;
  /** When true, sets the current org template version as the new baseline (clears upgrade). */
  adopt?: boolean;
  actorUser?: TemplateActorUser;
};
