export type TemplateEventType =
  | 'Template.Created.v1'
  | 'Template.Updated.v1'
  | 'Template.Published.v1'
  | 'Template.Archived.v1';

export interface TemplateEvent {
  type: TemplateEventType;
  templateId: string;
  orgId: string;
  version: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
