import { createLogger, type Logger } from '@api-hub/logger';

import { AlertRepository } from '../repositories/alert-repository';

/**
 * Shared wiring for alert domain services: {@link AlertRepository} + structured logger.
 * Orchestration subclasses live in {@link AlertService}; HTTP stays in the host app.
 */
export abstract class BaseAlertService {
  protected readonly repo: AlertRepository;
  protected readonly log: Logger;

  constructor(repo?: AlertRepository, log?: Logger) {
    this.repo = repo ?? new AlertRepository();
    this.log = log ?? createLogger({ service: 'alert-core', redactPII: true });
  }
}
