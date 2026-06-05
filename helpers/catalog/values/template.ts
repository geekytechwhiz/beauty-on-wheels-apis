import type { SimpleValueSeed } from '../../interfaces';

function global(code: string, label: string, sortOrder?: number): SimpleValueSeed {
  return { metadataValueCode: code, label, isGlobal: true, sortOrder };
}

function scoped(
  code: string,
  label: string,
  modules: string[],
  sortOrder?: number,
): SimpleValueSeed {
  return {
    metadataValueCode: code,
    label,
    isGlobal: false,
    applicableModules: modules,
    sortOrder,
  };
}

export const TEMPLATE_VALUES: Record<string, SimpleValueSeed[]> = {
  TemplateStatus: [
    global('SAVED', 'Saved', 1),
    global('IN_REVIEW', 'In Review', 2),
    global('PUBLISHED', 'Published', 3),
    global('INACTIVE', 'Inactive', 4),
  ],
  ShareScope: [global('PRIVATE', 'Private', 1), global('SHAREABLE', 'Shareable', 2)],
  ControlAction: [
    global('NO', 'No', 1),
    global('ADMIN', 'Admin', 2),
    global('ALL', 'All', 3),
  ],
  MetadataMode: [global('FIXED', 'Fixed', 1), global('EXPANDABLE', 'Expandable', 2)],
  DurationType: [
    scoped('DURATION_30D', '30 Days', ['CARE_PLAN', 'OKR'], 1),
    scoped('DURATION_90D', '90 Days', ['CARE_PLAN', 'OKR'], 2),
    scoped('DURATION_6M', '6 Months', ['CARE_PLAN', 'OKR'], 3),
    scoped('DURATION_12M', '12 Months', ['CARE_PLAN', 'OKR'], 4),
    scoped('DURATION_CUSTOM', 'Custom', ['CARE_PLAN', 'OKR'], 5),
  ],
  DataSourceType: [
    scoped('MANUAL', 'Manual', ['CARE_PLAN', 'OKR', 'THRESHOLD'], 1),
    scoped('HMS', 'HMS', ['CARE_PLAN', 'OKR', 'THRESHOLD'], 2),
    scoped('DEVICE', 'Device', ['CARE_PLAN', 'OKR', 'THRESHOLD'], 3),
    scoped('SYMPTOM_FORM', 'Symptom Form', ['CARE_PLAN', 'OKR', 'THRESHOLD'], 4),
    scoped('UPLOAD', 'Upload', ['CARE_PLAN', 'OKR', 'THRESHOLD'], 5),
    scoped('THIRD_PARTY', 'Third Party', ['CARE_PLAN', 'OKR', 'THRESHOLD'], 6),
  ],
  ReviewStatus: [
    scoped('PLANNED', 'Planned / Not Started', ['CARE_PLAN', 'OKR'], 1),
    scoped('IN_PROGRESS', 'In Progress', ['CARE_PLAN', 'OKR'], 2),
    scoped('AT_RISK', 'At Risk', ['CARE_PLAN', 'OKR'], 3),
    scoped('COMPLETED', 'Completed', ['CARE_PLAN', 'OKR'], 4),
    scoped('SKIPPED', 'Skipped', ['CARE_PLAN', 'OKR'], 5),
  ],
  Vital: [
    global('BLOOD_PRESSURE', 'Blood Pressure', 1),
    global('WEIGHT', 'Weight', 2),
    global('BMI', 'BMI', 3),
    global('OXYGEN', 'Oxygen', 4),
    global('GLUCOSE', 'Glucose', 5),
    global('HEART_RATE', 'Heart Rate', 6),
    global('SPO2', 'SpO2', 7),
    global('STEPS', 'Steps', 8),
    global('SLEEP', 'Sleep', 9),
    global('BODY_TEMPERATURE', 'Body Temperature', 10),
  ],
  Device: [
    scoped('BP_MONITOR', 'Blood Pressure Monitor', ['CARE_PLAN', 'THRESHOLD'], 1),
    scoped('GLUCOSE_METER', 'Glucose Meter', ['CARE_PLAN', 'THRESHOLD'], 2),
    scoped('PULSE_OXIMETER', 'Pulse Oximeter', ['CARE_PLAN', 'THRESHOLD'], 3),
  ],
};
