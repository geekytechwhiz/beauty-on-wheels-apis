import type { SimpleValueSeed } from '../../interfaces';

function global(code: string, label: string, sortOrder?: number): SimpleValueSeed {
  return { metadataValueCode: code, label, isGlobal: true, sortOrder };
}

export const FOUNDATIONAL_VALUES: Record<string, SimpleValueSeed[]> = {
  ApplicableModule: [
    global('CARE_PLAN', 'Care Plan', 1),
    global('OKR', 'OKR', 2),
    global('TASK', 'Task', 3),
    global('SYMPTOM', 'Symptom', 4),
    global('THRESHOLD', 'Threshold', 5),
    global('ALERT', 'Alert', 6),
  ],
  Category: [
    global('CHRONIC_DISEASE', 'Chronic Disease', 1),
    global('WELLNESS', 'Wellness', 2),
  ],
  Condition: [
    global('HYPERTENSION', 'Hypertension', 1),
    global('DIABETES', 'Diabetes', 2),
    global('ANNUAL_WELLNESS', 'Annual Wellness', 3),
  ],
  Country: [
    global('GLOBAL', 'Global', 1),
    global('US', 'United States', 2),
    global('IN', 'India', 3),
    global('GB', 'United Kingdom', 4),
  ],
  Language: [
    global('EN', 'English', 1),
    global('ES', 'Spanish', 2),
    global('HI', 'Hindi', 3),
  ],
};
