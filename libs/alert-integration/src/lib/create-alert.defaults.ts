/** Applied when `createAlert` is called without `inputType` / `sourceType` (e.g. public API body omits them). */
export const CREATE_ALERT_DEFAULT_INPUT_TYPE = 'ENGAGEMENT_TRIGGER' as const;
export const CREATE_ALERT_DEFAULT_SOURCE_TYPE = 'USER_INTERFACE' as const;
