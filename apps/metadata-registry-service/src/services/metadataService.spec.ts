import {
  STATUS,
  resolveStatusMode,
  validateMetadataTypeInput,
  type MetadataTypeInput,
  normalizeMetadataTypeInput,
  parseGetEntityStatusMode,
  parseListEntityStatusMode,
  parsePatchStatusBody,
  parseQueryIncludeInactive,
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

describe('parseQueryIncludeInactive', () => {
  it('recognizes include-inactive and includeInactive', () => {
    expect(parseQueryIncludeInactive({ 'include-inactive': 'true' })).toBe(true);
    expect(parseQueryIncludeInactive({ includeInactive: '1' })).toBe(true);
    expect(parseQueryIncludeInactive({})).toBe(false);
  });
});

describe('parseGetEntityStatusMode', () => {
  it('defaults to active-only when no query', () => {
    expect(parseGetEntityStatusMode({})).toBe('active');
  });

  it('treats ALL, both, and include-inactive as any-status', () => {
    expect(parseGetEntityStatusMode({ status: 'ALL' })).toBe('all');
    expect(parseGetEntityStatusMode({ status: 'both' })).toBe('all');
    expect(parseGetEntityStatusMode({ 'include-inactive': 'true' })).toBe('all');
    expect(parseGetEntityStatusMode({ includeInactive: '1' })).toBe('all');
    expect(parseGetEntityStatusMode({ includeInactive: 'yes' })).toBe('all');
  });

  it('include-inactive takes precedence over status=ACTIVE', () => {
    expect(parseGetEntityStatusMode({ status: 'ACTIVE', 'include-inactive': 'true' })).toBe('all');
  });
});

describe('parseListEntityStatusMode', () => {
  it('defaults to active; INACTIVE for inactive-only; all when include-inactive', () => {
    expect(parseListEntityStatusMode({})).toBe('active');
    expect(parseListEntityStatusMode({ status: 'INACTIVE' })).toBe('inactive');
    expect(parseListEntityStatusMode({ 'include-inactive': 'true' })).toBe('all');
  });

  it('includeInactive overrides status=ACTIVE', () => {
    expect(parseListEntityStatusMode({ status: 'ACTIVE', includeInactive: 'true' })).toBe('all');
  });

  it('accepts lowercase inactive', () => {
    expect(parseListEntityStatusMode({ status: 'inactive' })).toBe('inactive');
  });
});

describe('resolveStatusMode', () => {
  const base = { entityType: 'type' as const, metadataTypeCode: 'X', includeInactive: false };

  it('active when no status', () => {
    expect(resolveStatusMode(base)).toBe('active');
  });

  it('inactive when status INACTIVE', () => {
    expect(resolveStatusMode({ ...base, status: STATUS.INACTIVE })).toBe('inactive');
  });

  it('both when includeInactive regardless of status', () => {
    expect(resolveStatusMode({ ...base, includeInactive: true, status: STATUS.ACTIVE })).toBe('all');
  });
});
