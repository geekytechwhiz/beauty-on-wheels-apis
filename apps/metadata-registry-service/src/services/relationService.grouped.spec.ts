import type { MetadataRelationRecord } from '@api-hub/metadata';

const mockListRelationsByFrom = jest.fn();
const mockGetMetadataValue = jest.fn();
const mockGetRelationRepository = jest.fn();
const mockGetMetadataRepository = jest.fn();

jest.mock('@api-hub/metadata', () => ({
  ...jest.requireActual('@api-hub/metadata'),
  getRelationRepository: () => mockGetRelationRepository(),
  getMetadataRepository: () => mockGetMetadataRepository(),
}));

import { listRelatedValuesGrouped } from './relationService';

function relation(
  fromType: string,
  fromValue: string,
  toType: string,
  toValue: string,
): MetadataRelationRecord {
  return {
    id: `${fromType}#${fromValue}#${toType}#${toValue}`,
    relationType: 'PARENT_CHILD',
    fromMetadataTypeCode: fromType,
    fromMetadataValueCode: fromValue,
    toMetadataTypeCode: toType,
    toMetadataValueCode: toValue,
    status: 'ACTIVE',
    createdAt: '2020-01-01',
  };
}

describe('listRelatedValuesGrouped', () => {
  beforeEach(() => {
    mockListRelationsByFrom.mockReset();
    mockGetMetadataValue.mockReset();
    mockGetRelationRepository.mockReset();
    mockGetMetadataRepository.mockReset();
    mockGetRelationRepository.mockResolvedValue({
      listRelationsByFrom: mockListRelationsByFrom,
    } as never);
    mockGetMetadataRepository.mockResolvedValue({
      getMetadataValue: mockGetMetadataValue,
    } as never);
  });

  it('returns one group for a single source value with fromLabel and value labels', async () => {
    mockListRelationsByFrom.mockResolvedValue([relation('Country', 'IN', 'State', 'KA')]);
    mockGetMetadataValue.mockImplementation((typeCode: string, valueCode: string) => {
      if (typeCode === 'Country' && valueCode === 'IN') return Promise.resolve({ label: 'India' });
      if (typeCode === 'State' && valueCode === 'KA') return Promise.resolve({ label: 'Karnataka' });
      return Promise.resolve(null);
    });

    const groups = await listRelatedValuesGrouped('Country', ['IN'], {});

    expect(groups).toEqual([
      {
        fromMetadataTypeCode: 'Country',
        fromMetadataValueCode: 'IN',
        fromLabel: 'India',
        values: [{ metadataTypeCode: 'State', metadataValueCode: 'KA', label: 'Karnataka' }],
      },
    ]);
  });

  it('returns separate groups per source value and does not merge values', async () => {
    mockListRelationsByFrom.mockImplementation((fromType: string, fromValue: string) => {
      if (fromValue === 'IN') return Promise.resolve([relation('Country', 'IN', 'State', 'KA')]);
      if (fromValue === 'US') return Promise.resolve([relation('Country', 'US', 'State', 'CA')]);
      return Promise.resolve([]);
    });
    mockGetMetadataValue.mockImplementation((typeCode: string, valueCode: string) => {
      const labels: Record<string, string> = {
        'Country#IN': 'India',
        'Country#US': 'United States',
        'State#KA': 'Karnataka',
        'State#CA': 'California',
      };
      const label = labels[`${typeCode}#${valueCode}`];
      return Promise.resolve(label ? { label } : null);
    });

    const groups = await listRelatedValuesGrouped('Country', ['IN', 'US'], {});

    expect(groups).toHaveLength(2);
    expect(groups[0].fromMetadataValueCode).toBe('IN');
    expect(groups[0].fromLabel).toBe('India');
    expect(groups[0].values).toEqual([
      { metadataTypeCode: 'State', metadataValueCode: 'KA', label: 'Karnataka' },
    ]);
    expect(groups[1].fromMetadataValueCode).toBe('US');
    expect(groups[1].fromLabel).toBe('United States');
    expect(groups[1].values).toEqual([
      { metadataTypeCode: 'State', metadataValueCode: 'CA', label: 'California' },
    ]);
  });

  it('dedupes related values within a group by metadataTypeCode + metadataValueCode', async () => {
    mockListRelationsByFrom.mockResolvedValue([
      relation('Country', 'IN', 'State', 'KA'),
      relation('Country', 'IN', 'State', 'KA'),
      relation('Country', 'IN', 'State', 'TN'),
    ]);
    mockGetMetadataValue.mockResolvedValue({ label: 'X' } as never);

    const groups = await listRelatedValuesGrouped('Country', ['IN'], {});

    expect(groups[0].values).toEqual([
      { metadataTypeCode: 'State', metadataValueCode: 'KA', label: 'X' },
      { metadataTypeCode: 'State', metadataValueCode: 'TN', label: 'X' },
    ]);
  });

  it('omits label / fromLabel when no metadata value record is found', async () => {
    mockListRelationsByFrom.mockResolvedValue([relation('Country', 'IN', 'State', 'KA')]);
    mockGetMetadataValue.mockResolvedValue(null as never);

    const groups = await listRelatedValuesGrouped('Country', ['IN'], {});

    expect(groups[0]).toEqual({
      fromMetadataTypeCode: 'Country',
      fromMetadataValueCode: 'IN',
      values: [{ metadataTypeCode: 'State', metadataValueCode: 'KA' }],
    });
    expect(groups[0]).not.toHaveProperty('fromLabel');
    expect(groups[0].values[0]).not.toHaveProperty('label');
  });
});
