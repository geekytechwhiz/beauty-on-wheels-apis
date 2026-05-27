/**
 * @jest-environment node
 */
import { buildSocketDestinationKey } from './build-socket-destination-key';

describe('buildSocketDestinationKey', () => {
  it('builds user destination key', () => {
    expect(buildSocketDestinationKey({ kind: 'user', userId: 'DOC123' })).toBe(
      'USER#DOC123',
    );
  });

  it('strips USER# prefix from userId', () => {
    expect(buildSocketDestinationKey({ kind: 'user', userId: 'USER#DOC123' })).toBe(
      'USER#DOC123',
    );
  });

  it('builds org channel destination key', () => {
    expect(
      buildSocketDestinationKey({
        kind: 'org',
        organizationId: 'ORG1',
        channel: 'TEAM_ALERTS',
      }),
    ).toBe('ORG#ORG1#TEAM_ALERTS');
  });

  it('strips ORG# prefix from organizationId', () => {
    expect(
      buildSocketDestinationKey({
        kind: 'org',
        organizationId: 'ORG#ORG1',
        channel: 'TEAM_ALERTS',
      }),
    ).toBe('ORG#ORG1#TEAM_ALERTS');
  });

  it('builds patient destination key', () => {
    expect(buildSocketDestinationKey({ kind: 'patient', patientId: 'PAT001' })).toBe(
      'PATIENT#PAT001',
    );
  });

  it('strips PATIENT# prefix from patientId', () => {
    expect(
      buildSocketDestinationKey({ kind: 'patient', patientId: 'PATIENT#PAT001' }),
    ).toBe('PATIENT#PAT001');
  });
});
