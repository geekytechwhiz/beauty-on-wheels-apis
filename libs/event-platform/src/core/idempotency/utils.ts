// core/idempotency/utils.ts

export function isConditionalCheckFailure(err: any): boolean {
    return (
      err?.name === 'ConditionalCheckFailedException' ||
      err?.$metadata?.httpStatusCode === 400 // fallback
    );
  }

  export class DuplicateEventError extends Error {
    readonly isDuplicate = true;
  
    constructor(public readonly eventId: string) {
      super(`Duplicate event detected: ${eventId}`);
      this.name = 'DuplicateEventError';
    }
  }