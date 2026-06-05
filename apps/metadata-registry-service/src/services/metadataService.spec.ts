import {
  STATUS,
  ValidationError,
  lifecycleStatusesFromQuery,
  normalizeMetadataTypeInput,
  parseLifecycleStatusQuery,
  parsePatchStatusBody,
  recordMatchesLifecycleStatus,
  resolveLifecycleStatuses,
  validateMetadataTypeInput,
  type MetadataTypeInput,
} from '@api-hub/metadata';

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
    } as unknown as MetadataTypeInput & Record<string, unknown>);

    expect(normalized.status).toBe(STATUS.ACTIVE);
    expect(normalized.applicableModules).toEqual(['CARE_PLAN', 'OKR', 'ALERT']);
    expect(() => validateMetadataTypeInput(normalized, false)).not.toThrow();
  });

  it('normalizes inactive status case', () => {
    const normalized = normalizeMetadataTypeInput({
      ...base,
      applicableModules: ['OKR'],
      status: 'inactive',
    } as unknown as MetadataTypeInput & Record<string, unknown>);
    expect(normalized.status).toBe(STATUS.INACTIVE);
    expect(() => validateMetadataTypeInput(normalized, false)).not.toThrow();
  });

  it('leaves already-valid module tokens unchanged', () => {
    const normalized = normalizeMetadataTypeInput({
      ...base,
      applicableModules: ['CARE_PLAN', 'OKR'],
      status: 'ACTIVE',
    } as unknown as MetadataTypeInput & Record<string, unknown>);
    expect(normalized.applicableModules).toEqual(['CARE_PLAN', 'OKR']);
  });

  it('does not emit undefined keys for PATCH-style partial bodies (merge-friendly)', () => {
    const normalized = normalizeMetadataTypeInput({
      metadataTypeCode: 'SampleType',
      status: 'ACTIVE',
    } as unknown as MetadataTypeInput & Record<string, unknown>);
    expect(Object.keys(normalized).sort()).toEqual(['metadataTypeCode', 'status'].sort());
  });
});

describe('parsePatchStatusBody', () => {
  it('accepts Active and Inactive display casing for PATCH status', () => {
    expect(parsePatchStatusBody('Active')).toBe(STATUS.ACTIVE);
    expect(parsePatchStatusBody('Inactive')).toBe(STATUS.INACTIVE);
  });

  it('accepts all-uppercase and lowercase', () => {
    expect(parsePatchStatusBody('ACTIVE')).toBe(STATUS.ACTIVE);
    expect(parsePatchStatusBody('INACTIVE')).toBe(STATUS.INACTIVE);
    expect(parsePatchStatusBody('active')).toBe(STATUS.ACTIVE);
  });

  it('rejects undefined, null, and unknown values', () => {
    expect(() => parsePatchStatusBody(undefined)).toThrow();
    expect(() => parsePatchStatusBody(null)).toThrow();
    expect(() => parsePatchStatusBody('Unknown')).toThrow();
  });
});

describe('lifecycleStatusesFromQuery (GET/LIST)', () => {
  it('defaults to ACTIVE when status omitted', () => {
    expect(lifecycleStatusesFromQuery(undefined)).toEqual([STATUS.ACTIVE]);
  });

  it('maps ACTIVE, INACTIVE, DELETED, and ALL', () => {
    expect(lifecycleStatusesFromQuery('ACTIVE')).toEqual([STATUS.ACTIVE]);
    expect(lifecycleStatusesFromQuery('INACTIVE')).toEqual([STATUS.INACTIVE]);
    expect(lifecycleStatusesFromQuery('DELETED')).toEqual([STATUS.DELETED]);
    expect(lifecycleStatusesFromQuery('ALL')).toEqual([STATUS.ACTIVE, STATUS.INACTIVE]);
  });

  it('ALL excludes DELETED', () => {
    expect(lifecycleStatusesFromQuery('ALL')).not.toContain(STATUS.DELETED);
  });

  it('accepts lowercase status', () => {
    expect(lifecycleStatusesFromQuery('inactive')).toEqual([STATUS.INACTIVE]);
    expect(lifecycleStatusesFromQuery('all')).toEqual([STATUS.ACTIVE, STATUS.INACTIVE]);
  });

  it('rejects invalid status values with validation error', () => {
    expect(() => lifecycleStatusesFromQuery('DRAFT')).toThrow(ValidationError);
    expect(() => lifecycleStatusesFromQuery('UNKNOWN')).toThrow(ValidationError);
    expect(() => lifecycleStatusesFromQuery('deletedd')).toThrow(ValidationError);
  });

  it('GET and LIST use the same resolver', () => {
    const cases = [undefined, 'ACTIVE', 'INACTIVE', 'DELETED', 'ALL'] as const;
    for (const raw of cases) {
      expect(lifecycleStatusesFromQuery(raw)).toEqual(resolveLifecycleStatuses(parseLifecycleStatusQuery(raw)));
    }
  });
});

describe('recordMatchesLifecycleStatus', () => {
  it('matches only when status is in allowed set', () => {
    expect(recordMatchesLifecycleStatus(STATUS.DELETED, [STATUS.DELETED])).toBe(true);
    expect(recordMatchesLifecycleStatus(STATUS.DELETED, [STATUS.ACTIVE, STATUS.INACTIVE])).toBe(false);
    expect(recordMatchesLifecycleStatus(STATUS.INACTIVE, lifecycleStatusesFromQuery('ALL'))).toBe(true);
  });
});
