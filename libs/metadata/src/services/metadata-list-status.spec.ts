import { STATUS } from '../constants';
import type { ListMetadataInput } from '../types/list-metadata-input';
import {
  lifecycleStatusesFromQuery,
  parseLifecycleStatusQuery,
  resolveLifecycleStatuses,
} from '../domain/lifecycle-filter';

describe('lifecycle status (LIST input mapping)', () => {
  const base: ListMetadataInput = {
    entityType: 'value',
    metadataTypeCode: 'SampleType',
    lifecycleStatuses: [STATUS.ACTIVE],
  };

  it('defaults to ACTIVE', () => {
    expect(lifecycleStatusesFromQuery(undefined)).toEqual([STATUS.ACTIVE]);
    expect(base.lifecycleStatuses).toEqual([STATUS.ACTIVE]);
  });

  it('maps INACTIVE and DELETED', () => {
    expect(lifecycleStatusesFromQuery('INACTIVE')).toEqual([STATUS.INACTIVE]);
    expect(lifecycleStatusesFromQuery('DELETED')).toEqual([STATUS.DELETED]);
  });

  it('ALL returns ACTIVE and INACTIVE only', () => {
    expect(lifecycleStatusesFromQuery('ALL')).toEqual([STATUS.ACTIVE, STATUS.INACTIVE]);
    expect(resolveLifecycleStatuses('ALL')).not.toContain(STATUS.DELETED);
  });

  it('rejects invalid status', () => {
    expect(() => parseLifecycleStatusQuery('DRAFT')).toThrow();
  });
});
