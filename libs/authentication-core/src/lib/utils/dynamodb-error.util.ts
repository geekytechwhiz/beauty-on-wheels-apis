import { isConditionalWriteConflict } from '@api-hub/utils';

/**
 * True when a DynamoDB conditional expression failed (put, update, or transact).
 */
export function isDynamoConditionalFailure(err: unknown): boolean {
  if (isConditionalWriteConflict(err)) {
    return true;
  }

  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'ConditionalCheckFailedException'
  );
}
