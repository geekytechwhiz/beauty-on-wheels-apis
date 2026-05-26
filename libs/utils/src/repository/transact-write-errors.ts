import {
  ConditionalWriteConflictError,
  type TransactCancellationReason,
} from '../errors/app.error';

export type { TransactCancellationReason };

export type TransactionCanceledExceptionShape = {
  name: 'TransactionCanceledException';
  CancellationReasons?: TransactCancellationReason[];
  message?: string;
};

const TRANSACTION_CANCELED = 'TransactionCanceledException';
const CONDITIONAL_CHECK_FAILED = 'ConditionalCheckFailed';

export function isTransactionCanceledException(
  err: unknown,
): err is TransactionCanceledExceptionShape {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as { name?: string }).name === TRANSACTION_CANCELED
  );
}

export function getTransactCancellationReasons(
  err: unknown,
): TransactCancellationReason[] {
  if (!isTransactionCanceledException(err)) {
    return [];
  }
  return err.CancellationReasons ?? [];
}

/** Indexes of transact items whose condition failed (`Code === ConditionalCheckFailed`). */
export function transactConditionalFailureIndexes(err: unknown): number[] {
  return getTransactCancellationReasons(err)
    .map((reason, index) =>
      reason.Code === CONDITIONAL_CHECK_FAILED ? index : -1,
    )
    .filter((index) => index >= 0);
}

export function hasTransactConditionalFailure(err: unknown): boolean {
  return transactConditionalFailureIndexes(err).length > 0;
}

export function isTransactConditionalFailureAtIndex(
  err: unknown,
  itemIndex: number,
): boolean {
  return transactConditionalFailureIndexes(err).includes(itemIndex);
}

export function isConditionalWriteConflict(
  err: unknown,
): err is ConditionalWriteConflictError {
  return err instanceof ConditionalWriteConflictError;
}

/**
 * True when {@link ConditionalWriteConflictError} came from a transact item at `itemIndex`,
 * or when the wrapped cause is a raw `TransactionCanceledException` with that index.
 */
export function isConditionalWriteConflictAtIndex(
  err: unknown,
  itemIndex: number,
): boolean {
  if (!(err instanceof ConditionalWriteConflictError)) {
    return isTransactConditionalFailureAtIndex(err, itemIndex);
  }

  if (err.failedTransactItemIndexes?.includes(itemIndex)) {
    return true;
  }

  return isTransactConditionalFailureAtIndex(err.cause, itemIndex);
}
