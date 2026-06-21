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
  actorUser?: TemplateActorUser;
};
