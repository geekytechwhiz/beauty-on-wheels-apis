export type TemplateKey =
  | 'WELCOME_USER'
  | 'WELCOME_STAFF'
  | 'INVITE_USER'
  | 'PROFILE_UPDATED'
  | 'GENERIC_NOTIFICATION';

export interface NotificationTemplate {
  subject?: string;
  body?: string;
  sms?: string;
}

export type TemplateData = Record<string, unknown>;