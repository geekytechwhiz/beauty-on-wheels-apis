import type { MetadataTypeSeedDefinition } from '../../interfaces';

export const COMPLEX_TYPE_DEFINITIONS: MetadataTypeSeedDefinition[] = [
  {
    metadataTypeCode: 'MetricCode',
    displayName: 'Metric Code',
    description: 'Governed measurable metric catalog',
    valueDataType: 'Enum',
    multiSelectAllowed: false,
    applicableModules: ['OKR', 'THRESHOLD', 'ALERT'],
    status: 'ACTIVE',
    attributeSchema: {
      attributes: [
        { name: 'dataType', type: 'string', mandatory: true },
        { name: 'unit', type: 'string', mandatory: false },
        { name: 'supportedSourceTypes', type: 'array', mandatory: false },
        { name: 'supportedEvaluationLogic', type: 'array', mandatory: false },
        { name: 'directionality', type: 'string', mandatory: false },
        { name: 'decimalAllowed', type: 'boolean', mandatory: false },
        { name: 'minSupportedValue', type: 'number', mandatory: false },
        { name: 'maxSupportedValue', type: 'number', mandatory: false },
      ],
    },
  },
  {
    metadataTypeCode: 'QuestionCode',
    displayName: 'Question Code',
    description: 'Governed symptom and assessment question codes',
    valueDataType: 'Enum',
    multiSelectAllowed: false,
    applicableModules: ['SYMPTOM', 'THRESHOLD', 'ALERT'],
    status: 'ACTIVE',
    attributeSchema: {
      attributes: [
        { name: 'questionText', type: 'string', mandatory: true },
        { name: 'questionType', type: 'string', mandatory: true },
        { name: 'thresholdEligible', type: 'boolean', mandatory: true },
        { name: 'answerScale', type: 'string', mandatory: false },
      ],
    },
  },
];
