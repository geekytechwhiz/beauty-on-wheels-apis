import { createLogger, type Logger } from '@api-hub/observability';

import { TaskRepository } from '../repositories/task-repository';

export abstract class BaseTaskService {
  protected readonly repo: TaskRepository;
  protected readonly log: Logger;

  constructor(repo?: TaskRepository, log?: Logger) {
    this.repo = repo ?? new TaskRepository();
    this.log = log ?? createLogger({ service: 'task-core', redactPII: true });
  }
}
