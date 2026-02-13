/** Manual mock for @api-hub/error-messages used by messageResolver.spec.ts */
export const getErrorDefinition = jest.fn();
export const normalizeLanguage = jest.fn((lang: string | null | undefined) => lang || 'en');
