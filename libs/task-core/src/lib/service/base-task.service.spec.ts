import { createLogger } from '@api-hub/observability';

import { TaskRepository } from '../repositories/task-repository';
import { BaseTaskService } from './base-task.service';

class TestTaskService extends BaseTaskService {
  exposeRepo() {
    return this.repo;
  }

  exposeLog() {
    return this.log;
  }
}

describe('BaseTaskService', () => {
  it('uses injected repository and logger when provided', () => {
    const repo = {} as TaskRepository;
    const log = createLogger({ service: 'test', redactPII: true });
    const svc = new TestTaskService(repo, log);

    expect(svc.exposeRepo()).toBe(repo);
    expect(svc.exposeLog()).toBe(log);
  });

  it('defaults repository and logger when omitted', () => {
    const svc = new TestTaskService();

    expect(svc.exposeRepo()).toBeInstanceOf(TaskRepository);
    expect(svc.exposeLog()).toBeDefined();
  });
});
