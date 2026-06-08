import { TaskKeyBuilder } from './task-key.builder';

describe('TaskKeyBuilder', () => {
  it('builds patient partition and meta sort keys from dueWindowStart', () => {
    const pk = TaskKeyBuilder.buildPatientPartitionKey('org-1', 'pat-1');
    expect(pk).toBe('ORG#org-1#PAT#pat-1');

    const sk = TaskKeyBuilder.buildMetaSk(1780567200000, 1780610400000, 'rtask-abc');
    expect(sk).toBe('DUE#1780567200000#TASK#rtask-abc');
  });

  it('builds LSI1 and HIST sort keys', () => {
    expect(TaskKeyBuilder.buildLsi1Sk('cp-1', 'rtask-abc')).toBe('CP#cp-1#TASK#rtask-abc');
    expect(TaskKeyBuilder.buildHistSk(1780554600000, 'hist-1')).toBe('HIST#1780554600000#hist-1');
  });
});
