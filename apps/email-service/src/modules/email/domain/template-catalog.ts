import { createHash } from 'node:crypto';

export const TEMPLATE_PARAMETER_TYPE = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
} as const;

export type TemplateParameterType =
  (typeof TEMPLATE_PARAMETER_TYPE)[keyof typeof TEMPLATE_PARAMETER_TYPE];

export type TemplateParameterDeclaration = {
  name: string;
  required: boolean;
  type: TemplateParameterType;
};

export type TemplateCatalogEntry = {
  active: boolean;
  version: string;
  locales?: readonly string[];
  parameters: readonly TemplateParameterDeclaration[];
};

export type TemplateCatalog = Readonly<Record<string, TemplateCatalogEntry>>;

type CatalogEnvironment = {
  vendorOnboardingTemplateName: string;
  vendorEmailConfirmationTemplateName: string;
  bookingConfirmedTemplateName: string;
};

export function buildTemplateCatalog(env: CatalogEnvironment): TemplateCatalog {
  return {
    [env.vendorOnboardingTemplateName]: {
      active: true,
      version: '1',
      parameters: [
        { name: 'applicationId', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'vendorId', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'businessName', required: false, type: TEMPLATE_PARAMETER_TYPE.STRING },
      ],
    },
    [env.vendorEmailConfirmationTemplateName]: {
      active: true,
      version: '1',
      parameters: [
        { name: 'firstName', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'otp', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'expiryMinutes', required: true, type: TEMPLATE_PARAMETER_TYPE.NUMBER },
      ],
    },
    [env.bookingConfirmedTemplateName]: {
      active: true,
      version: '1',
      parameters: [
        { name: 'bookingId', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'vendorId', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'bookingDate', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'slotId', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'customerName', required: false, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'vendorName', required: false, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'totalAmount', required: false, type: TEMPLATE_PARAMETER_TYPE.NUMBER },
      ],
    },
  };
}

export function recipientHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
}

export function redactEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf('@');
  if (at <= 0) {
    return '[redacted-email]';
  }
  return `${trimmed.slice(0, 1)}***@${trimmed.slice(at + 1)}`;
}
