import type { TemplateActorUser } from '../template-actor.model';

export type MasterTemplateUpdateBody = {
  meta?: Record<string, unknown>;
  steps?: unknown[];
  links?: Record<string, unknown>;
  carePlanAttributes?: Record<string, unknown>;
  templateTypeConfig?: Record<string, unknown>;
  [key: string]: unknown;
};

export type StatusTransitionBody = {
  action: string;
  comment?: string | null;
  reason?: string | null;
};

export type UpdateMasterVersionParams = {
  templateId: string;
  versionId: string;
  body: MasterTemplateUpdateBody;
  actorUser?: TemplateActorUser;
};

export type TransitionMasterStatusParams = {
  templateId: string;
  versionId: string;
  body: StatusTransitionBody;
  actorUser?: TemplateActorUser;
};

/** Unified master save — content update and/or lifecycle (POST /templates/{templateId}). */
export type SaveMasterTemplateParams = {
  templateId: string;
  /** When path uses templateVersionId (e.g. TASK-CODE-V01), targets that version. */
  templateVersionId?: string;
  body: Record<string, unknown>;
  actorUser?: TemplateActorUser;
};

