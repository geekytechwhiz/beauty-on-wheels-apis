import { STATUS } from './constants';
import { getMetadataTypeDelta, typeCreateAuditNewValue, metadataTypeToAuditSnapshot } from './type-audit-delta';
import type { MetadataTypeRecord } from './types';

const base: MetadataTypeRecord = {
  metadataTypeCode: 'MetricCode',
  version: 2,
  displayName: 'Metrics',
  description: 'd',
  valueDataType: 'Enum',
  multiSelectAllowed: false,
  applicableModules: ['OKR'],
  attributeSchema: { attributes: [] },
  status: STATUS.ACTIVE,
  createdAt: 'a',
  lastModifiedAt: 'b',
  createdBy: 'u1',
  lastModifiedBy: 'u1',
};

describe('getMetadataTypeDelta', () => {
  it('returns only status if only status changes', () => {
    const a = { ...base, version: 2 };
    const b = { ...a, version: 3, status: STATUS.INACTIVE };
    const d = getMetadataTypeDelta(a, b);
    expect(d).toEqual({
      oldValue: { status: STATUS.ACTIVE },
      newValue: { status: STATUS.INACTIVE },
    });
  });

  it('emits schemaVersion when separate-schema type attributeSchema changes and version bumps', () => {
    const a: MetadataTypeRecord = {
      ...base,
      version: 1,
      attributeSchema: { attributes: [{ name: 'a' }] },
    };
    const b: MetadataTypeRecord = {
      ...a,
      version: 2,
      attributeSchema: { attributes: [{ name: 'a' }, { name: 'b' }] },
    };
    const d = getMetadataTypeDelta(a, b);
    expect(d.oldValue).toEqual({ schemaVersion: 1 });
    expect(d.newValue).toEqual({ schemaVersion: 2 });
  });
});

describe('typeCreateAuditNewValue', () => {
  it('keeps create payload minimal and includes schemaVersion', () => {
    const r: MetadataTypeRecord = {
      ...base,
      version: 1,
    };
    expect(typeCreateAuditNewValue(r)).toEqual({
      displayName: 'Metrics',
      valueDataType: 'Enum',
      multiSelectAllowed: false,
      applicableModules: ['OKR'],
      status: STATUS.ACTIVE,
      schemaVersion: 1,
    });
  });
});

describe('metadataTypeToAuditSnapshot', () => {
  it('strips system fields and metadataTypeCode', () => {
    const s = metadataTypeToAuditSnapshot(base);
    expect(s).not.toHaveProperty('version');
    expect(s).not.toHaveProperty('metadataTypeCode');
    expect(s).toHaveProperty('displayName', 'Metrics');
  });
});
