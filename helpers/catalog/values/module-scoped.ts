import type { SimpleValueSeed } from '../../interfaces';

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

export const MODULE_SCOPED_VALUES: Record<string, SimpleValueSeed[]> = {
  Priority: [
    scoped('P0', 'P0', ['THRESHOLD', 'ALERT'], 1),
    scoped('P1', 'P1', ['THRESHOLD', 'ALERT'], 2),
    scoped('P2', 'P2', ['THRESHOLD', 'ALERT'], 3),
  ],
  EvaluationLogic: [
    scoped('AVERAGE', 'Average', ['OKR'], 1),
    scoped('LATEST_VALUE', 'Latest Value', ['OKR'], 2),
    scoped('ROLLING_AVERAGE', 'Rolling Average', ['OKR'], 3),
    scoped('THRESHOLD_BASED', 'Threshold Based', ['OKR'], 4),
  ],
  QuestionType: [
    scoped('NUMERIC', 'Numeric', ['SYMPTOM'], 1),
    scoped('YES_NO', 'Yes/No', ['SYMPTOM'], 2),
    scoped('MULTI_SELECT', 'Multi Select', ['SYMPTOM'], 3),
    scoped('SINGLE_SELECT', 'Single Select', ['SYMPTOM'], 4),
    scoped('SCALE_1_10', 'Scale 1–10', ['SYMPTOM'], 5),
    scoped('SCALE_NEG_5', 'Scale −5 to +5', ['SYMPTOM'], 6),
    scoped('LOW_MED_HIGH', 'Low/Med/High', ['SYMPTOM'], 7),
    scoped('FREE_TEXT', 'Free Text', ['SYMPTOM'], 8),
  ],
  ReminderChannel: [
    scoped('SMS', 'SMS', ['TASK', 'SYMPTOM', 'ALERT'], 1),
    scoped('EMAIL', 'Email', ['TASK', 'SYMPTOM', 'ALERT'], 2),
    scoped('PUSH', 'Push', ['TASK', 'SYMPTOM', 'ALERT'], 3),
    scoped('IN_APP', 'In-App', ['TASK', 'SYMPTOM', 'ALERT'], 4),
  ],
  ReminderFrequency: [
    scoped('ONCE_DAILY', 'Once Daily', ['SYMPTOM'], 1),
    scoped('TWICE_DAILY', 'Twice Daily', ['SYMPTOM'], 2),
    scoped('EVERY_3_DAYS', 'Every 3 Days', ['SYMPTOM'], 3),
    scoped('WEEKLY', 'Weekly', ['SYMPTOM'], 4),
    scoped('MONTHLY', 'Monthly', ['SYMPTOM'], 5),
  ],
  TaskCategory: [
    scoped('ONBOARDING', 'Onboarding', ['TASK'], 1),
    scoped('MONITORING', 'Monitoring', ['TASK'], 2),
    scoped('MEDICATION', 'Medication', ['TASK'], 3),
    scoped('EXERCISE', 'Exercise', ['TASK'], 4),
    scoped('NUTRITION', 'Nutrition', ['TASK'], 5),
    scoped('ASSESSMENT', 'Assessment', ['TASK'], 6),
    scoped('EDUCATION', 'Education', ['TASK'], 7),
    scoped('APPOINTMENT', 'Appointment', ['TASK'], 8),
    scoped('DEVICE', 'Device', ['TASK'], 9),
  ],
  AssignedToType: [
    scoped('ORG_STAFF', 'Org Staff', ['TASK', 'ALERT'], 1),
    scoped('PATIENT', 'Patient', ['TASK', 'ALERT'], 2),
  ],
  ScheduleType: [
    scoped('ONE_TIME', 'One Time', ['TASK'], 1),
    scoped('RECURRING', 'Recurring', ['TASK'], 2),
  ],
  RecurrencePattern: [
    scoped('ONCE_DAILY', 'Once Daily', ['TASK'], 1),
    scoped('TWICE_DAILY', 'Twice Daily', ['TASK'], 2),
    scoped('EVERY_3_DAYS', 'Every 3 Days', ['TASK'], 3),
    scoped('WEEKLY', 'Weekly', ['TASK'], 4),
    scoped('MONTHLY', 'Monthly', ['TASK'], 5),
  ],
  StartRule: [
    scoped('ON_CARE_PLAN_START', 'On Care Plan Start', ['TASK'], 1),
    scoped('ON_KR_START', 'On KR Start', ['TASK'], 2),
    scoped('ON_ENROLLMENT', 'On Enrollment', ['TASK'], 3),
    scoped('AFTER_X_DAYS_FROM_KR_START', 'After X Days from KR Start', ['TASK'], 4),
  ],
  EndRule: [
    scoped('ON_CARE_PLAN_END', 'On Care Plan End', ['TASK'], 1),
    scoped('ON_KR_END', 'On KR End', ['TASK'], 2),
    scoped('AFTER_X_DAYS_FROM_START', 'After X Days from Start', ['TASK'], 3),
    scoped('ON_FIRST_COMPLETION', 'On First Completion', ['TASK'], 4),
  ],
  ObjectiveCategory: [
    scoped('CLINICAL', 'Clinical', ['OKR'], 1),
    scoped('LIFESTYLE', 'Lifestyle', ['OKR'], 2),
    scoped('PREVENTION', 'Prevention', ['OKR'], 3),
  ],
  KRType: [
    scoped('QUALITATIVE', 'Qualitative', ['OKR'], 1),
    scoped('QUANTITATIVE', 'Quantitative', ['OKR'], 2),
  ],
  AppliesToType: [
    scoped('METRIC', 'Metric', ['THRESHOLD', 'ALERT'], 1),
    scoped('SYMPTOM_QUESTION', 'Symptom Question', ['THRESHOLD', 'ALERT'], 2),
    scoped('DEVICE', 'Device', ['THRESHOLD', 'ALERT'], 3),
    scoped('ENGAGEMENT_EVENT', 'Engagement Event', ['THRESHOLD', 'ALERT'], 4),
  ],
  SeverityLevel: [
    scoped('WARNING', 'Warning', ['THRESHOLD'], 1),
    scoped('CRITICAL', 'Critical', ['THRESHOLD'], 2),
  ],
  ComparisonOperator: [
    scoped('GREATER_THAN', 'Greater Than', ['THRESHOLD'], 1),
    scoped('LESS_THAN', 'Less Than', ['THRESHOLD'], 2),
    scoped('BETWEEN', 'Between', ['THRESHOLD'], 3),
    scoped('CRITICAL_HIGH', 'Critical High', ['THRESHOLD'], 4),
    scoped('CRITICAL_LOW', 'Critical Low', ['THRESHOLD'], 5),
  ],
  GroupingType: [
    scoped('ONE_OPEN_PER_PATIENT', 'One Open Per Patient', ['ALERT'], 1),
    scoped('PER_PATIENT_PER_METRIC', 'Per Patient Per Metric', ['ALERT'], 2),
    scoped('PER_BAND', 'Per Band', ['ALERT'], 3),
    scoped('PER_SCHEDULE', 'Per Schedule', ['ALERT'], 4),
  ],
  GroupingStrategy: [
    scoped('PATIENT_METRIC', 'Patient+Metric', ['ALERT'], 1),
    scoped('PATIENT_METRIC_BAND', 'Patient+Metric+Band', ['ALERT'], 2),
    scoped('PATIENT_SCHEDULE', 'Patient+Schedule', ['ALERT'], 3),
    scoped('PATIENT_DEVICE', 'Patient+Device', ['ALERT'], 4),
  ],
  CategoryCode: [
    scoped('VITALS', 'Vitals', ['ALERT'], 1),
    scoped('DEVICE', 'Device', ['ALERT'], 2),
    scoped('ENGAGEMENT', 'Engagement', ['ALERT'], 3),
    scoped('SYMPTOMS', 'Symptoms', ['ALERT'], 4),
  ],
  AlertState: [
    scoped('UNASSIGNED', 'Unassigned', ['ALERT'], 1),
    scoped('ASSIGNED', 'Assigned', ['ALERT'], 2),
    scoped('IN_PROGRESS', 'In Progress', ['ALERT'], 3),
    scoped('WAITING', 'Waiting', ['ALERT'], 4),
    scoped('RESOLVED', 'Resolved', ['ALERT'], 5),
    scoped('DISMISSED', 'Dismissed', ['ALERT'], 6),
  ],
  AlertInputType: [],
  AlertSourceType: [],
};
