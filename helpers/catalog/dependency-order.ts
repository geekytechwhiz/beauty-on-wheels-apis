import { filterOrderForScope } from './seed-scope';

/** Full dependency-safe metadata type creation order. */
const FULL_METADATA_TYPE_DEPENDENCY_ORDER: string[] = [
  // Tier 0 — foundational
  'ApplicableModule',
  'Category',
  'Condition',
  'Country',
  'Language',
  'Specialty',
  // Tier 1 — geography / onboarding
  'State',
  'City',
  'CountryPhoneCode',
  'Currency',
  // Tier 2 — template / shared
  'TemplateStatus',
  'ShareScope',
  'ControlAction',
  'MetadataMode',
  'DurationType',
  'DataSourceType',
  'ReviewStatus',
  'Vital',
  'Device',
  // Tier 3 — module-scoped
  'Priority',
  'EvaluationLogic',
  'QuestionType',
  'ReminderChannel',
  'ReminderFrequency',
  'TaskCategory',
  'AssignedToType',
  'ScheduleType',
  'RecurrencePattern',
  'StartRule',
  'EndRule',
  'ObjectiveCategory',
  'KRType',
  'AppliesToType',
  'SeverityLevel',
  'ComparisonOperator',
  'GroupingType',
  'GroupingStrategy',
  'CategoryCode',
  'AlertState',
  'AlertInputType',
  'AlertSourceType',
  // Tier 5 — schema-backed (after QuestionType values exist)
  'MetricCode',
  'QuestionCode',
];

export const METADATA_TYPE_DEPENDENCY_ORDER = filterOrderForScope(
  FULL_METADATA_TYPE_DEPENDENCY_ORDER,
);
