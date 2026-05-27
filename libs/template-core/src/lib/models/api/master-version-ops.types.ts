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
  actorUserId?: string;
};

export type TransitionMasterStatusParams = {
  templateId: string;
  versionId: string;
  body: StatusTransitionBody;
  actorUserId?: string;
};

