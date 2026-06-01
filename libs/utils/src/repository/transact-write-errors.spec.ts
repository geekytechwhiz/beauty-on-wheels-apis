import { ConditionalWriteConflictError } from '../errors/app.error';
import {
  getTransactCancellationReasons,
  hasTransactConditionalFailure,
  isConditionalWriteConflictAtIndex,
  isTransactionCanceledException,
  transactConditionalFailureIndexes,
} from './transact-write-errors';

function transactionCanceled(
  reasons: Array<{ Code?: string }>,
): { name: string; CancellationReasons: Array<{ Code?: string }> } {
  return {
    name: 'TransactionCanceledException',
    CancellationReasons: reasons,
  };
}

describe('transact-write-errors', () => {
  it('detects conditional failure at index', () => {
    const err = transactionCanceled([
      { Code: 'ConditionalCheckFailed' },
      { Code: 'None' },
    ]);

    expect(isTransactionCanceledException(err)).toBe(true);
    expect(hasTransactConditionalFailure(err)).toBe(true);
    expect(transactConditionalFailureIndexes(err)).toEqual([0]);
    expect(isConditionalWriteConflictAtIndex(err, 0)).toBe(true);
    expect(isConditionalWriteConflictAtIndex(err, 1)).toBe(false);
  });

  it('maps ConditionalWriteConflictError with failed indexes', () => {
    const raw = transactionCanceled([{ Code: 'ConditionalCheckFailed' }]);
    const wrapped = new ConditionalWriteConflictError(raw, {
      cancellationReasons: getTransactCancellationReasons(raw),
      failedTransactItemIndexes: [0],
    });

    expect(isConditionalWriteConflictAtIndex(wrapped, 0)).toBe(true);
    expect(wrapped.failedTransactItemIndexes).toEqual([0]);
  });

  it('returns false for non-transact errors', () => {
    expect(hasTransactConditionalFailure(new Error('boom'))).toBe(false);
    expect(transactConditionalFailureIndexes({ name: 'ValidationException' })).toEqual(
      [],
    );
  });
});
