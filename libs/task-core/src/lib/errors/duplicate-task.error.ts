import { BaseError } from '@api-hub/utils';

export class DuplicateTaskError extends BaseError {
  constructor(runtimeTaskInstanceId: string) {
    super(`Duplicate task detected: ${runtimeTaskInstanceId}`, 409, 'DUPLICATE_TASK');
  }
}
