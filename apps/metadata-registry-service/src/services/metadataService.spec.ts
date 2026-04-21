import { STATUS, validateMetadataTypeInput, type MetadataTypeInput } from '@api-hub/metadata';
import { normalizeMetadataTypeInput } from './metadataService';

describe('normalizeMetadataTypeInput', () => {
  const base = {
    metadataTypeCode: 'MetricCode',
    displayName: 'Metric Code',
    description: 'Optional description',
    valueDataType: 'Enum',
    multiSelectAllowed: false,
    attributeSchema: {
      attributes: [
        { name: 'dataType', type: 'String' },
        { name: 'supportedSourceTypes', type: 'String' },
      ],
    },
    createdBy: 'system',
    lastModifiedBy: 'system',
  } satisfies Partial<MetadataTypeInput>;

  it('accepts frontend-style status and module labels on create', () => {
    const normalized = normalizeMetadataTypeInput({
      ...base,
      applicableModules: ['CarePlan', 'OKR', 'Alert'],
      status: 'Active',
    } as MetadataTypeInput & Record<string, unknown>);

    expect(normalized.status).toBe(STATUS.ACTIVE);
    expect(normalized.applicableModules).toEqual(['CARE_PLAN', 'OKR', 'ALERT']);
    expect(() => validateMetadataTypeInput(normalized, false)).not.toThrow();
  });

  it('normalizes inactive status case', () => {
    const normalized = normalizeMetadataTypeInput({
      ...base,
      applicableModules: ['OKR'],
      status: 'inactive',
    } as MetadataTypeInput & Record<string, unknown>);
    expect(normalized.status).toBe(STATUS.INACTIVE);
    expect(() => validateMetadataTypeInput(normalized, false)).not.toThrow();
  });

  it('leaves already-valid module tokens unchanged', () => {
    const normalized = normalizeMetadataTypeInput({
      ...base,
      applicableModules: ['CARE_PLAN', 'OKR'],
      status: 'ACTIVE',
    } as MetadataTypeInput & Record<string, unknown>);
    expect(normalized.applicableModules).toEqual(['CARE_PLAN', 'OKR']);
  });
});
