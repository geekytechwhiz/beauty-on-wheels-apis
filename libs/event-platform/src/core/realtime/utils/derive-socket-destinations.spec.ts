/**
 * @jest-environment node
 */
import { deriveSocketDestinations } from './derive-socket-destinations';

describe('deriveSocketDestinations', () => {
  it('targets org channel only when scope is ORG', () => {
    const destinations = deriveSocketDestinations({
      channel: 'ALERTS',
      eventType: 'Alert.Created.Processed',
      recipientIds: ['user-1'],
      payload: { organizationId: 'org-1', realtimeNotifyScope: 'ORG' },
    });

    expect(destinations).toEqual(['ORG#org-1#ALERTS']);
  });

  it('targets users only when scope is RECIPIENTS', () => {
    const destinations = deriveSocketDestinations({
      channel: 'ALERTS',
      eventType: 'Alert.Created.Processed',
      recipientIds: ['user-1', 'user-2'],
      payload: { organizationId: 'org-1', realtimeNotifyScope: 'RECIPIENTS' },
    });

    expect(destinations).toEqual(['USER#user-1', 'USER#user-2']);
  });

  it('targets org and users when scope is BOTH', () => {
    const destinations = deriveSocketDestinations({
      channel: 'ALERTS',
      eventType: 'Alert.Created.Processed',
      recipientIds: ['user-1'],
      payload: { organizationId: 'org-1', realtimeNotifyScope: 'BOTH' },
    });

    expect(destinations).toEqual(['USER#user-1', 'ORG#org-1#ALERTS']);
  });
});
