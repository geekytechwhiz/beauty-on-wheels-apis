import { toPublicAlert } from '@api-hub/alert-integration';
import type { AlertRecord } from '@api-hub/alert-repository';

describe('alert-service (e2e smoke)', () => {
  it('strips Dynamo keys from public DTO', () => {
    const row = {
      pk: 'ALERT#x',
      sk: 'META',
      gsi1pk: 'P',
      gsi1sk: 'S',
      gsi2pk: 'O',
      gsi2sk: 'T',
      alertId: '01HX',
      patientId: 'p1',
      organizationId: 'o1',
      inputEventId: 'e1',
      inputType: 'BP',
      alertState: 'OPEN' as const,
      priority: 1,
      triggerTimestamp: new Date().toISOString(),
      slaBreachIndicator: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies AlertRecord;
    const pub = toPublicAlert(row);
    expect(pub).not.toHaveProperty('pk');
    expect(pub.alertId).toBe('01HX');
  });
});
