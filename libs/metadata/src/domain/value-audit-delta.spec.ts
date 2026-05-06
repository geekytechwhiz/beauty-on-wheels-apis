import { STATUS } from '../constants';
import { getMetadataValueDelta, valueCreateAuditNewValue, resolveValueUpdateAction } from './value-audit-delta';
import type { MetadataValueRecord } from '../models/types';

const base: Omit<MetadataValueRecord, 'version' | 'valueCode' | 'label'> = {
  metadataTypeCode: 'MetricCode',
  description: 'd',
  sortOrder: 0,
  status: STATUS.ACTIVE,
  isGlobal: true,
  attributes: { dataType: 'Numeric' },
  applicability: {
    module: ['OKR'],
    category: [],
    condition: [],
    country: [],
    language: [],
  },
  applSkKeys: [],
  createdAt: 't0',
  lastModifiedAt: 't0',
  createdBy: 'u1',
  lastModifiedBy: 'u1',
};

function v(over: Partial<MetadataValueRecord> & { valueCode: string }): MetadataValueRecord {
  return {
    ...base,
    ...over,
    version: 1,
    valueCode: over.valueCode,
    label: over.label ?? 'L',
  };
}

describe('getMetadataValueDelta', () => {
  it('returns only status when status changes', () => {
    const a = v({ valueCode: 'V1' });
    const b = { ...a, status: STATUS.INACTIVE };
    const d = getMetadataValueDelta(a, b);
    expect(d).toEqual({
      oldValue: { status: STATUS.ACTIVE },
      newValue: { status: STATUS.INACTIVE },
    });
  });

  it('returns deep valueAttributes delta', () => {
    const a = v({ valueCode: 'V1', attributes: { x: 1, y: 2 } });
    const b = { ...a, attributes: { x: 1, y: 3 } };
    const d = getMetadataValueDelta(a, b);
    expect(d.oldValue).toEqual({ valueAttributes: { y: 2 } });
    expect(d.newValue).toEqual({ valueAttributes: { y: 3 } });
  });

  it('splits applicableModules only', () => {
    const a = v({
      valueCode: 'V1',
      applicability: { module: ['A'], category: ['C'], condition: [], country: [], language: [] },
    });
    const b = {
      ...a,
      applicability: { module: ['A', 'B'], category: ['C'], condition: [], country: [], language: [] },
    };
    const d = getMetadataValueDelta(a, b);
    expect(d).toEqual({
      oldValue: { applicableModules: ['A'] },
      newValue: { applicableModules: ['A', 'B'] },
    });
  });
});

describe('valueCreateAuditNewValue', () => {
  it('is minimal for CREATE', () => {
    const r = v({ valueCode: 'C1' });
    expect(valueCreateAuditNewValue(r)).toEqual({
      metadataValueCode: 'C1',
      label: 'L',
      status: STATUS.ACTIVE,
      isGlobal: true,
    });
  });
});

describe('resolveValueUpdateAction', () => {
  it('returns UPDATE for label-only', () => {
    const a = v({ valueCode: 'M1' });
    const b = { ...a, label: 'N' };
    expect(resolveValueUpdateAction('MetricCode', a, b)).toBe('UPDATE');
  });
});
