import { describe, expect, it } from '@jest/globals';
import { buildOrgListGsi1Sk } from './organizationList.sort';

describe('organizationList.sort', () => {
  it('buildOrgListGsi1Sk orders newer createdAt before older (ascending GSI scan)', () => {
    const newer = buildOrgListGsi1Sk(2_000, 'org-new');
    const older = buildOrgListGsi1Sk(1_000, 'org-old');
    expect(newer < older).toBe(true);
  });
});
