export class AlertErrorMapper {
    private static readonly GROUP_TRANSACT_ITEM_INDEX = 3;
  
    static isTransactionCanceled(
      err: unknown
    ): err is { name: string; CancellationReasons?: { Code?: string }[] } {
      return !!err && typeof err === 'object' &&
        (err as { name?: string }).name === 'TransactionCanceledException';
    }
  
    static isGroupPutConditionalRace(err: unknown): boolean {
      if (!this.isTransactionCanceled(err)) return false;
      return (err.CancellationReasons ?? [])[this.GROUP_TRANSACT_ITEM_INDEX]?.Code === 'ConditionalCheckFailed';
    }
  }