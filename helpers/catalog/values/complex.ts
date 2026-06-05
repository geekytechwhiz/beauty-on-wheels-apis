import type { RichValueSeed } from '../../interfaces';

/** Condition values with Category relations (phase 3). */
export const CONDITION_RICH_VALUES: RichValueSeed[] = [
  {
    metadataValueCode: 'HYPERTENSION',
    label: 'Hypertension',
    isGlobal: true,
    sortOrder: 1,
    relationships: [{ targetMetadataValueCode: 'CHRONIC_DISEASE' }],
  },
  {
    metadataValueCode: 'DIABETES',
    label: 'Diabetes',
    isGlobal: true,
    sortOrder: 2,
    relationships: [{ targetMetadataValueCode: 'CHRONIC_DISEASE' }],
  },
  {
    metadataValueCode: 'ANNUAL_WELLNESS',
    label: 'Annual Wellness',
    isGlobal: true,
    sortOrder: 3,
    relationships: [{ targetMetadataValueCode: 'WELLNESS' }],
  },
];

export const CONDITION_RICH_VALUE_TYPE_BY_CODE: Record<string, string> = {
  HYPERTENSION: 'Condition',
  DIABETES: 'Condition',
  ANNUAL_WELLNESS: 'Condition',
};

/** Device values linked to Vitals (phase 3). */
export const DEVICE_RICH_VALUES: RichValueSeed[] = [
  {
    metadataValueCode: 'BP_MONITOR',
    label: 'Blood Pressure Monitor',
    isGlobal: false,
    applicableModules: ['CARE_PLAN', 'THRESHOLD'],
    relationships: [{ targetMetadataValueCode: 'BLOOD_PRESSURE' }],
  },
  {
    metadataValueCode: 'GLUCOSE_METER',
    label: 'Glucose Meter',
    isGlobal: false,
    applicableModules: ['CARE_PLAN', 'THRESHOLD'],
    relationships: [{ targetMetadataValueCode: 'GLUCOSE' }],
  },
  {
    metadataValueCode: 'PULSE_OXIMETER',
    label: 'Pulse Oximeter',
    isGlobal: false,
    applicableModules: ['CARE_PLAN', 'THRESHOLD'],
    relationships: [{ targetMetadataValueCode: 'SPO2' }],
  },
];

export const DEVICE_RICH_VALUE_TYPE_BY_CODE: Record<string, string> = {
  BP_MONITOR: 'Device',
  GLUCOSE_METER: 'Device',
  PULSE_OXIMETER: 'Device',
};

export const METRIC_CODE_RICH_VALUES: RichValueSeed[] = [
  {
    metadataValueCode: 'BP_SYSTOLIC',
    label: 'Blood Pressure Systolic',
    isGlobal: true,
    valueAttributes: {
      dataType: 'Numeric',
      unit: 'mmHg',
      supportedSourceTypes: ['Device', 'Manual', 'HMS'],
      supportedEvaluationLogic: ['LatestValue', 'Average', 'ThresholdBased'],
      directionality: 'Neutral',
      decimalAllowed: false,
    },
  },
  {
    metadataValueCode: 'BP_DIASTOLIC',
    label: 'Blood Pressure Diastolic',
    isGlobal: true,
    valueAttributes: {
      dataType: 'Numeric',
      unit: 'mmHg',
      supportedSourceTypes: ['Device', 'Manual', 'HMS'],
      supportedEvaluationLogic: ['LatestValue', 'Average'],
      directionality: 'Neutral',
    },
  },
  {
    metadataValueCode: 'HEART_RATE',
    label: 'Heart Rate',
    isGlobal: true,
    valueAttributes: {
      dataType: 'Numeric',
      unit: 'bpm',
      supportedSourceTypes: ['Device', 'Manual'],
      supportedEvaluationLogic: ['LatestValue', 'RollingAverage'],
      directionality: 'Neutral',
    },
  },
  {
    metadataValueCode: 'SPO2',
    label: 'SpO2',
    isGlobal: true,
    valueAttributes: {
      dataType: 'Numeric',
      unit: '%',
      supportedSourceTypes: ['Device', 'Manual'],
      supportedEvaluationLogic: ['LatestValue', 'ThresholdBased'],
      directionality: 'IncreaseBetter',
    },
  },
];

export const METRIC_CODE_RICH_VALUE_TYPE_BY_CODE: Record<string, string> = {
  BP_SYSTOLIC: 'MetricCode',
  BP_DIASTOLIC: 'MetricCode',
  HEART_RATE: 'MetricCode',
  SPO2: 'MetricCode',
};

export const QUESTION_CODE_RICH_VALUES: RichValueSeed[] = [
  {
    metadataValueCode: 'BP_SYMPTOM_SEVERITY',
    label: 'Blood pressure symptom severity',
    isGlobal: false,
    applicableModules: ['SYMPTOM', 'THRESHOLD', 'ALERT'],
    valueAttributes: {
      questionText: 'How severe are your blood pressure symptoms today?',
      questionType: 'SCALE_1_10',
      thresholdEligible: true,
    },
  },
  {
    metadataValueCode: 'GLUCOSE_FASTING',
    label: 'Fasting glucose reading',
    isGlobal: false,
    applicableModules: ['SYMPTOM', 'THRESHOLD'],
    valueAttributes: {
      questionText: 'What was your fasting glucose reading?',
      questionType: 'NUMERIC',
      thresholdEligible: true,
    },
  },
  {
    metadataValueCode: 'MEDICATION_ADHERENCE',
    label: 'Medication adherence',
    isGlobal: false,
    applicableModules: ['SYMPTOM'],
    valueAttributes: {
      questionText: 'Did you take your prescribed medication today?',
      questionType: 'YES_NO',
      thresholdEligible: false,
    },
  },
];

export const QUESTION_CODE_RICH_VALUE_TYPE_BY_CODE: Record<string, string> = {
  BP_SYMPTOM_SEVERITY: 'QuestionCode',
  GLUCOSE_FASTING: 'QuestionCode',
  MEDICATION_ADHERENCE: 'QuestionCode',
};
