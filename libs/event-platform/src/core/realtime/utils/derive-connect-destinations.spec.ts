/**
 * @jest-environment node
 */
import { buildSocketDestinationKey } from './build-socket-destination-key';
import { deriveConnectDestinations, parseCommaSeparatedList } from './derive-connect-destinations';

describe('deriveConnectDestinations', () => {
  it('adds user and org channel destinations', () => {
    const destinations = deriveConnectDestinations({
      userId: 'DOC123',
      organizationId: 'ORG1',
      channels: ['ALERTS', 'TEAM_ALERTS'],
    });

    expect(destinations).toEqual([
      buildSocketDestinationKey({ kind: 'user', userId: 'DOC123' }),
      buildSocketDestinationKey({
        kind: 'org',
        organizationId: 'ORG1',
        channel: 'ALERTS',
      }),
      buildSocketDestinationKey({
        kind: 'org',
        organizationId: 'ORG1',
        channel: 'TEAM_ALERTS',
      }),
    ]);
  });

  it('includes extra destinations verbatim', () => {
    const destinations = deriveConnectDestinations({
      extraDestinations: ['PATIENT#PAT001'],
    });

    expect(destinations).toEqual(['PATIENT#PAT001']);
  });

  it('parses comma-separated lists', () => {
    expect(parseCommaSeparatedList('A, B,,C')).toEqual(['A', 'B', 'C']);
  });
});
