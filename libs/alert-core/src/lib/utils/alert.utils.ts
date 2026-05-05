import { AlertActivity } from "../models/domain/alert-activity.model";
import { TRANSACT_INDEX_EVENT } from "../constants/alert.constants";

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

/** Opaque GET /alerts pagination: DynamoDB Query `LastEvaluatedKey` as `nextToken`. */
export function encodeListAlertsCursor(
  lastEvaluatedKey: Record<string, unknown> | undefined,
): string | undefined {
  if (!lastEvaluatedKey || Object.keys(lastEvaluatedKey).length === 0) return undefined;
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf8').toString('base64url');
}

export function decodeListAlertsCursor(token: string | undefined): Record<string, unknown> | undefined {
  const t = token?.trim();
  if (!t) return undefined;
  try {
    const json = Buffer.from(t, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      invalidListAlertsCursor();
    }
    return parsed as Record<string, unknown>;
  } catch {
    invalidListAlertsCursor();
  }
}

function invalidListAlertsCursor(): never {
  const e = new Error('Invalid nextToken') as Error & { statusCode: number; code: string };
  e.statusCode = 400;
  e.code = 'VALIDATION_ERROR';
  throw e;
}
