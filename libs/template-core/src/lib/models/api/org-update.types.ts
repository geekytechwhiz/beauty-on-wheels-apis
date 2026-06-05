import type { TemplateActorUser } from '../template-actor.model';
import type { MasterTemplateUpdateBody, StatusTransitionBody } from './master-version-ops.types';

/** OpenAPI OrgTemplateUpdateRequest — same shape as master update + overrides. */
export type OrgTemplateUpdateBody = MasterTemplateUpdateBody & {
  overrides?: Record<string, unknown>;
};

export type UpdateOrgTemplateVersionParams = {
  organizationId: string;
  templateId: string;
  versionId: string;
  body: OrgTemplateUpdateBody;
  actorUser?: TemplateActorUser;
};

export type TransitionOrgStatusParams = {
  organizationId: string;
  templateId: string;
  versionId: string;
  body: StatusTransitionBody;
  actorUser?: TemplateActorUser;
};
