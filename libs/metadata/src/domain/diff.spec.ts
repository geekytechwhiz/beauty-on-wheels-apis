import {
  isApplicabilityRestricting,
  isAttributeSchemaCompatibleExtension,
  isMetadataTypeBreakingChange,
  isMetadataValueStructureBreaking,
} from './diff';

describe('isMetadataTypeBreakingChange', () => {
  const base = {
    metadataTypeCode: 'T',
    valueDataType: 'Numeric',
    applicableModules: ['Provider'],
    multiSelectAllowed: false,
    status: 'ACTIVE' as const,
  };

  it('detects valueDataType change as breaking', () => {
    const before = { ...base };
    const after = { ...base, valueDataType: 'Boolean' };
    expect(isMetadataTypeBreakingChange(before, after)).toBe(true);
  });

  it('allows descriptive-only when schema unchanged', () => {
    const before = { ...base, attributeSchema: { a: 1 } };
    const after = { ...base, description: 'd', attributeSchema: { a: 1 } };
    expect(isMetadataTypeBreakingChange(before, after)).toBe(false);
  });

  it('allows compatible attributeSchema extension only', () => {
    const before = { ...base, attributeSchema: { a: 1 } };
    const after = { ...base, attributeSchema: { a: 1, b: 2 } };
    expect(isAttributeSchemaCompatibleExtension(before.attributeSchema!, after.attributeSchema!)).toBe(true);
    expect(isMetadataTypeBreakingChange(before, after)).toBe(false);
  });

  it('treats status change as breaking', () => {
    const before = { ...base };
    const after = { ...base, status: 'INACTIVE' as const };
    expect(isMetadataTypeBreakingChange(before, after)).toBe(true);
  });
});

describe('isMetadataValueStructureBreaking', () => {
  it('QuestionCode: questionText only is not breaking', () => {
    const before = {
      questionText: 'Old',
      questionType: 'Scale1to10',
      thresholdEligible: true,
    };
    const after = {
      questionText: 'New wording',
      questionType: 'Scale1to10',
      thresholdEligible: true,
    };
    expect(isMetadataValueStructureBreaking('QuestionCode', before, after)).toBe(false);
  });

  it('QuestionCode: questionType change is breaking', () => {
    const before = {
      questionText: 'Q',
      questionType: 'Scale1to10',
      thresholdEligible: true,
    };
    const after = { ...before, questionType: 'YesNo' };
    expect(isMetadataValueStructureBreaking('QuestionCode', before, after)).toBe(true);
  });

  it('MetricCode: any structured field change is breaking', () => {
    const before = { dataType: 'Numeric', unit: 'mmHg' };
    const after = { dataType: 'Numeric', unit: 'kPa' };
    expect(isMetadataValueStructureBreaking('MetricCode', before, after)).toBe(true);
  });

  it('generic type: additive value attributes are not breaking', () => {
    const before = { a: 1 };
    const after = { a: 1, b: 2 };
    expect(isMetadataValueStructureBreaking('CustomType', before, after)).toBe(false);
  });

  it('generic type: changed attribute value is breaking', () => {
    const before = { a: 1 };
    const after = { a: 2 };
    expect(isMetadataValueStructureBreaking('CustomType', before, after)).toBe(true);
  });
});

describe('isApplicabilityRestricting', () => {
  it('detects removed module token', () => {
    const before = { module: ['A', 'B'], category: [], condition: [], country: [] };
    const after = { module: ['A'], category: [], condition: [], country: [] };
    expect(isApplicabilityRestricting(before, after)).toBe(true);
  });

  it('allows expansion only', () => {
    const before = { module: ['A'], category: [], condition: [], country: [] };
    const after = { module: ['A', 'B'], category: [], condition: [], country: [] };
    expect(isApplicabilityRestricting(before, after)).toBe(false);
  });
});
