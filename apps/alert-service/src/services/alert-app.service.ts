import { AlertService } from '@api-hub/alert-integration';

let instance: AlertService | undefined;

/** Singleton for Lambda warm starts; business rules live in @api-hub/alert-integration. */
export function getAlertService(): AlertService {
  if (!instance) {
    instance = new AlertService();
  }
  return instance;
}
