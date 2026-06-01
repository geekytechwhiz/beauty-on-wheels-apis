/** Supported template types for UI meta JSON in `src/services-json`. */
export const TEMPLATE_UI_META_TYPES = [
  'ALERT_POLICY',
  'ALERT',
  'MONITORING',
  'GOAL',
  'TASK',
  'THRESHOLD',
  'SYMPTOM',
] as const;

export type TemplateUiMetaType = (typeof TEMPLATE_UI_META_TYPES)[number];

/** Canonical filename written on upsert. */
export const UI_META_CANONICAL_FILE: Record<TemplateUiMetaType, string> = {
  ALERT_POLICY: 'alert-api-response.json',
  ALERT: 'alert-api-response.json',
  MONITORING: 'monitoring-api-response.json',
  GOAL: 'goal-api-response.json',
  TASK: 'task-api-response.json',
  THRESHOLD: 'threshold-api-response.json',
  SYMPTOM: 'symptom-api-response.json',
};

/** Legacy filenames still read if present (local dev imports). */
export const UI_META_LEGACY_FILES: Partial<Record<TemplateUiMetaType, string[]>> = {
  ALERT_POLICY: ['alert-api-response (1).json'],
  ALERT: ['alert-api-response (1).json'],
  MONITORING: ['monitoring-api-response (1).json'],
};

export function normalizeTemplateUiMetaType(raw: string): TemplateUiMetaType | undefined {
  const key = raw.trim().toUpperCase().replace(/-/g, '_');
  return (TEMPLATE_UI_META_TYPES as readonly string[]).includes(key)
    ? (key as TemplateUiMetaType)
    : undefined;
}

export function resolveTemplateTypeForMetaId(metaId: string): TemplateUiMetaType | undefined {
  const prefix = metaId.trim().toUpperCase().split('-')[0];
  switch (prefix) {
    case 'ALERT':
      return 'ALERT_POLICY';
    case 'MONITORING':
      return 'MONITORING';
    case 'GOAL':
      return 'GOAL';
    case 'TASK':
      return 'TASK';
    case 'THRESHOLD':
      return 'THRESHOLD';
    case 'SYMPTOM':
      return 'SYMPTOM';
    default:
      return undefined;
  }
}
