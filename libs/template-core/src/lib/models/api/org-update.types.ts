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
  actorUserId?: string;
};

export type TransitionOrgStatusParams = {
  organizationId: string;
  templateId: string;
  versionId: string;
  body: StatusTransitionBody;
  actorUserId?: string;
};
