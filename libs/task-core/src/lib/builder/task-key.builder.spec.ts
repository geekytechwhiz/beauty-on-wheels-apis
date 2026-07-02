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

  it('builds GSI1 pk with STAFF# assignee id only (assignedToType is on META, not in GSI)', () => {
    expect(TaskKeyBuilder.buildGsi1Pk('org-1', 'staff-1')).toBe('ORG#org-1#STAFF#staff-1');
    expect(TaskKeyBuilder.buildGsi1Pk('org-1', 'role-42')).toBe('ORG#org-1#STAFF#role-42');
    expect(TaskKeyBuilder.buildGsi1Pk('org-1', 'user-9')).toBe('ORG#org-1#STAFF#user-9');
  });
});
