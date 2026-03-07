export enum TemplateType {
  WELCOME_USER = 'WELCOME_USER',
  WELCOME_STAFF = 'WELCOME_STAFF',
  INVITE_USER = 'INVITE_USER',
  PROFILE_UPDATED = 'PROFILE_UPDATED',
  GENERIC_NOTIFICATION = 'GENERIC_NOTIFICATION',
}

export interface NotificationTemplate {
  subject?: string;
  body?: string;
  sms?: string;
}

export type TemplateData = Record<string, unknown>;