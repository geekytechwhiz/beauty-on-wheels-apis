import { AlertService, toPublicAlert } from '../index';
import type { AlertRecord } from '@api-hub/alert-repository';

describe('alert-integration', () => {
  it('exports AlertService and toPublicAlert', () => {
    expect(new AlertService()).toBeInstanceOf(AlertService);
    const row = {
      pk: 'A',
      sk: 'M',
      gsi1pk: 'p',
      gsi1sk: 's',
      gsi2pk: 'o',
      gsi2sk: 't',
      alertId: 'id',
      patientId: 'p',
      organizationId: 'o',
      inputEventId: 'e',
      inputType: 't',
      alertState: 'OPEN' as const,
      priority: 1,
      triggerTimestamp: 't',
      slaBreachIndicator: false,
      createdAt: 'c',
      updatedAt: 'u',
    } satisfies AlertRecord;
    expect(toPublicAlert(row).alertId).toBe('id');
  });
});
