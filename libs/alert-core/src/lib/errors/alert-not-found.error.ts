import { BaseError } from '@api-hub/utils';

export class AlertNotFoundError extends BaseError {
  constructor(alertId?: string) {
    super(
      alertId ? `Alert not found: ${alertId}` : 'Alert not found',
      404,
      'ALERT_NOT_FOUND',
    );
  }
}
