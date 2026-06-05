import type { MetadataTypeSeedDefinition } from '../../interfaces';

const enumType = (
  code: string,
  displayName: string,
  multiSelect: boolean,
  applicableModules: string[],
): MetadataTypeSeedDefinition => ({
  metadataTypeCode: code,
  displayName,
  valueDataType: 'Enum',
  multiSelectAllowed: multiSelect,
  status: 'ACTIVE',
  applicableModules,
  valueApplicabilityConfig: { moduleScoped: true },
});

export const MODULE_SCOPED_TYPE_DEFINITIONS: MetadataTypeSeedDefinition[] = [
  enumType('Priority', 'Priority', false, ['THRESHOLD', 'ALERT']),
  enumType('EvaluationLogic', 'Evaluation Logic', false, ['OKR']),
  enumType('QuestionType', 'Question Type', false, ['SYMPTOM']),
  enumType('ReminderChannel', 'Reminder Channel', true, ['TASK', 'SYMPTOM', 'ALERT']),
  enumType('ReminderFrequency', 'Reminder Frequency', false, ['SYMPTOM']),
  enumType('TaskCategory', 'Task Category', false, ['TASK']),
  enumType('AssignedToType', 'Assigned To Type', false, ['TASK', 'ALERT']),
  enumType('ScheduleType', 'Schedule Type', false, ['TASK']),
  enumType('RecurrencePattern', 'Recurrence Pattern', false, ['TASK']),
  enumType('StartRule', 'Start Rule', false, ['TASK']),
  enumType('EndRule', 'End Rule', false, ['TASK']),
  enumType('ObjectiveCategory', 'Objective Category', false, ['OKR']),
  enumType('KRType', 'KR Type', false, ['OKR']),
  enumType('AppliesToType', 'Applies To Type', false, ['THRESHOLD', 'ALERT']),
  enumType('SeverityLevel', 'Severity Level', false, ['THRESHOLD']),
  enumType('ComparisonOperator', 'Comparison Operator', false, ['THRESHOLD']),
  enumType('GroupingType', 'Grouping Type', false, ['ALERT']),
  enumType('GroupingStrategy', 'Grouping Strategy', false, ['ALERT']),
  enumType('CategoryCode', 'Category Code', false, ['ALERT']),
  enumType('AlertState', 'Alert State', false, ['ALERT']),
  enumType('AlertInputType', 'Alert Input Type', false, ['ALERT']),
  enumType('AlertSourceType', 'Alert Source Type', false, ['ALERT']),
];
