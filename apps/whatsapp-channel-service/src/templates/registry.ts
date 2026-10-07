export const TEMPLATE_KEY = {
  BOOKING_CONFIRMATION: 'BOOKING_CONFIRMATION',
  BOOKING_REMINDER: 'BOOKING_REMINDER',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  MARKETING_OFFER: 'MARKETING_OFFER',
} as const;

export type TemplateKey = (typeof TEMPLATE_KEY)[keyof typeof TEMPLATE_KEY];

export interface WhatsAppTemplateDefinition {
  key: TemplateKey;
  metaName: string;
  language: string;
  version: string;
  requiredVariables: string[];
  marketing: boolean;
}

export const TEMPLATE_REGISTRY: Record<TemplateKey, WhatsAppTemplateDefinition> = {
  BOOKING_CONFIRMATION: {
    key: TEMPLATE_KEY.BOOKING_CONFIRMATION,
    metaName: 'booking_confirmation_v1',
    language: 'en',
    version: '1',
    requiredVariables: ['bookingId', 'date', 'amount'],
    marketing: false,
  },
  BOOKING_REMINDER: {
    key: TEMPLATE_KEY.BOOKING_REMINDER,
    metaName: 'booking_reminder_v1',
    language: 'en',
    version: '1',
    requiredVariables: ['bookingId', 'date', 'time'],
    marketing: false,
  },
  BOOKING_CANCELLED: {
    key: TEMPLATE_KEY.BOOKING_CANCELLED,
    metaName: 'booking_cancelled_v1',
    language: 'en',
    version: '1',
    requiredVariables: ['bookingId'],
    marketing: false,
  },
  PAYMENT_PENDING: {
    key: TEMPLATE_KEY.PAYMENT_PENDING,
    metaName: 'payment_pending_v1',
    language: 'en',
    version: '1',
    requiredVariables: ['bookingId', 'amount'],
    marketing: false,
  },
  PAYMENT_SUCCESS: {
    key: TEMPLATE_KEY.PAYMENT_SUCCESS,
    metaName: 'payment_success_v1',
    language: 'en',
    version: '1',
    requiredVariables: ['bookingId', 'amount'],
    marketing: false,
  },
  MARKETING_OFFER: {
    key: TEMPLATE_KEY.MARKETING_OFFER,
    metaName: 'marketing_offer_v1',
    language: 'en',
    version: '1',
    requiredVariables: ['offerName'],
    marketing: true,
  },
};

export function missingTemplateVariables(
  definition: WhatsAppTemplateDefinition,
  variables: Record<string, string>,
): string[] {
  return definition.requiredVariables.filter((name) => !variables[name]?.trim());
}

export function renderTemplateParameters(
  definition: WhatsAppTemplateDefinition,
  variables: Record<string, string>,
): Array<{ type: 'text'; text: string }> {
  return definition.requiredVariables.map((name) => ({ type: 'text', text: variables[name] }));
}
