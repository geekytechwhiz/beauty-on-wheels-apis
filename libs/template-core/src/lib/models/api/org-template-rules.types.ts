import type { TemplateActorUser } from '../template-actor.model';
import type { PartialTemplateFieldRule } from '../../utils/template-rules.utils';

export type GetOrgTemplateRulesParams = {
  masterTemplateId: string;
  organizationId: string;
};

export type UpdateOrgTemplateRulesParams = {
  masterTemplateId: string;
  organizationId: string;
  rules: Record<string, PartialTemplateFieldRule>;
  actorUser?: TemplateActorUser;
};
