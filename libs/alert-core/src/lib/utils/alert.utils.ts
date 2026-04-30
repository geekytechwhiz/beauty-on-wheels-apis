import { AlertActivity } from "../models/domain/alert-activity.model";
import { TRANSACT_INDEX_EVENT, TRANSACT_INDEX_GROUP } from "../constants/alert.constants";

export function  isTransactionCanceled(
    err: unknown,
  ): err is { name: string; CancellationReasons?: { Code?: string }[] } {
    return (
      !!err &&
      typeof err === 'object' &&
      (err as { name?: string }).name === 'TransactionCanceledException'
    );
  }
  
  export function  isEventConditionalFailure(err: unknown): boolean {
    if (!isTransactionCanceled(err)) return false;
    return (
      (err.CancellationReasons ?? [])[TRANSACT_INDEX_EVENT]?.Code === 'ConditionalCheckFailed'
    );
  }
  
  export function  isGroupPutConditionalRace(err: unknown): boolean {
    if (!isTransactionCanceled(err)) return false;
    return (
      (err.CancellationReasons ?? [])[TRANSACT_INDEX_GROUP]?.Code === 'ConditionalCheckFailed'
    );
  }
  
  export function  toPublicActivity(raw: Record<string, unknown>): AlertActivity {
    const {
      pk: _pk,
      sk: _sk,
      entityType: _entityType,
      organizationId: _organizationId,
      ...rest
    } = raw;
    return rest as unknown as AlertActivity;
  } 

  export function assertAlertTable(): string {
    const t = process.env.ALERT_TABLE;
    if (!t) {
      throw new Error('ALERT_TABLE environment variable is not set');
    }
    return t;
  }