import { STATUS } from '../constants';
import type { MetadataTypeRecord } from '../models/types';
import { ValidationError } from '../domain/errors';
import { relationPartitionKey, relationSortKey } from '../domain/relation-keys';
import {
  syncMetadataValueRelationships,
  validateValueRelationshipsPayload,
} from './metadata-value-relation.service';

const baseType = (): MetadataTypeRecord => ({
  metadataTypeCode: 'State',
  version: 1,
  displayName: 'State',
  valueDataType: 'Enum',
  multiSelectAllowed: false,
  applicableModules: [],
  supportsRelations: true,
  relationFieldLabel: 'Parent',
  targetMetadataTypeCode: 'Country',
  selectionMode: 'SINGLE',
  relationRequired: true,
  relationType: 'PARENT_CHILD',
  status: STATUS.ACTIVE,
  createdAt: 'a',
  lastModifiedAt: 'a',
});

describe('validateValueRelationshipsPayload', () => {
  it('requires relationships on create when relationRequired is true', () => {
    const t = baseType();
    expect(() =>
      validateValueRelationshipsPayload(t, {
        mode: 'create',
        relationshipsSent: false,
        targetCodes: undefined,
      }),
    ).toThrow(ValidationError);
  });

  it('allows PATCH without relationships when relationRequired is true (preserved)', () => {
    const t = baseType();
    expect(() =>
      validateValueRelationshipsPayload(t, {
        mode: 'update',
        relationshipsSent: false,
        targetCodes: undefined,
      }),
    ).not.toThrow();
  });

  it('rejects more than one target in SINGLE mode', () => {
    const t = baseType();
    expect(() =>
      validateValueRelationshipsPayload(t, {
        mode: 'update',
        relationshipsSent: true,
        targetCodes: ['IN', 'US'],
      }),
    ).toThrow(/SINGLE/);
  });

  it('allows multiple targets in MULTI mode (ServiceType → Specialty)', () => {
    const t: MetadataTypeRecord = {
      ...baseType(),
      metadataTypeCode: 'ServiceType',
      targetMetadataTypeCode: 'Specialty',
      selectionMode: 'MULTI',
      relationRequired: false,
      relationType: 'ALLOWED_FOR',
    };
    expect(() =>
      validateValueRelationshipsPayload(t, {
        mode: 'create',
        relationshipsSent: true,
        targetCodes: ['CARDIOLOGY', 'ENDOCRINOLOGY'],
      }),
    ).not.toThrow();
  });
});

describe('syncMetadataValueRelationships (ALLOWED_FOR)', () => {
  it('creates ServiceType → Specialty relation rows with ALLOWED_FOR sort keys', async () => {
    const typeRecord: MetadataTypeRecord = {
      metadataTypeCode: 'ServiceType',
      version: 1,
      displayName: 'Service Type',
      valueDataType: 'Enum',
      multiSelectAllowed: true,
      applicableModules: ['SERVICE'],
      supportsRelations: true,
      relationFieldLabel: 'Allowed Specialties',
      targetMetadataTypeCode: 'Specialty',
      selectionMode: 'MULTI',
      relationRequired: false,
      relationType: 'ALLOWED_FOR',
      status: STATUS.ACTIVE,
      createdAt: 'a',
      lastModifiedAt: 'a',
    };

    const mockListRelationsByFrom = jest.fn().mockResolvedValue([]);
    const mockCreateRelation = jest.fn().mockImplementation((input) =>
      Promise.resolve({
        id: 'rel-1',
        ...input,
        status: 'ACTIVE',
        createdAt: '2020-01-01',
      }),
    );
    const mockGetRelationByKey = jest.fn().mockResolvedValue(null);
    const mockGetMetadataValue = jest.fn().mockImplementation((typeCode: string, code: string) => {
      if (typeCode === 'ServiceType' && code === 'CONSULTATION') {
        return Promise.resolve({ valueCode: code, status: STATUS.ACTIVE, label: 'Consultation' });
      }
      if (typeCode === 'Specialty') {
        return Promise.resolve({ valueCode: code, status: STATUS.ACTIVE, label: code });
      }
      return Promise.resolve(null);
    });
    const mockGetMetadataType = jest.fn().mockImplementation((code: string) => {
      if (code === 'ServiceType' || code === 'Specialty') {
        return Promise.resolve({ metadataTypeCode: code, status: STATUS.ACTIVE });
      }
      return Promise.resolve(null);
    });

    const rel = {
      listRelationsByFrom: mockListRelationsByFrom,
      createRelation: mockCreateRelation,
      getRelationByKey: mockGetRelationByKey,
    };
    const meta = {
      getMetadataValue: mockGetMetadataValue,
      getMetadataType: mockGetMetadataType,
    };

    await syncMetadataValueRelationships(
      meta as never,
      rel as never,
      typeRecord,
      'CONSULTATION',
      true,
      ['CARDIOLOGY', 'ENDOCRINOLOGY'],
      'tester',
    );

    expect(mockCreateRelation).toHaveBeenCalledTimes(2);
    const firstCall = mockCreateRelation.mock.calls[0]![0];
    expect(firstCall).toMatchObject({
      relationType: 'ALLOWED_FOR',
      fromMetadataTypeCode: 'ServiceType',
      fromMetadataValueCode: 'CONSULTATION',
      toMetadataTypeCode: 'Specialty',
      toMetadataValueCode: 'CARDIOLOGY',
    });
    expect(
      relationSortKey('ALLOWED_FOR', 'Specialty', 'CARDIOLOGY'),
    ).toBe('ALLOWED_FOR#Specialty#CARDIOLOGY');
    expect(relationPartitionKey('ServiceType', 'CONSULTATION')).toBe(
      'RELATION#ServiceType#CONSULTATION',
    );
  });
});
