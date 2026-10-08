import { getLogger } from '@api-hub/observability';

import {
  DELIVERY_STATUS,
  FAILURE_CLASS,
  type DeliveryStatus,
} from '../domain/delivery-status.js';
import {
  IdempotencyConflictError,
  SesPermanentError,
  SesRetryableError,
} from '../domain/errors.js';
import type {
  DeliveryClaimInput,
  EmailDeliveryStore,
} from '../idempotency/email-delivery-store.js';
import { classifySesError } from '../ses/classify-ses-error.js';

export type TrackedSendResult = {
  messageId: string;
  duplicate: boolean;
  status?: DeliveryStatus;
};

/**
 * Shared claim → send → markSent orchestration.
 * SES acceptance and markSent are not one transaction. If the process dies after SES
 * accepts the message and before markSent, the claim stays inProgress without a messageId.
 * A later attempt stops (inProgress, then uncertain) and does not send a second email.
 */
export async function sendWithDeliveryTracking(options: {
  store: EmailDeliveryStore;
  claim: DeliveryClaimInput;
  dispatch: () => Promise<{ messageId: string }>;
}): Promise<TrackedSendResult> {
  const claim = await options.store.claim(options.claim);

  if (claim.outcome === 'duplicate') {
    return {
      messageId: claim.messageId ?? '',
      duplicate: true,
      status: claim.status,
    };
  }
  if (claim.outcome === 'inProgress') {
    throw new IdempotencyConflictError(
      'Email delivery is already in progress for this notification',
      true,
    );
  }
  if (claim.outcome === 'uncertain') {
    throw new IdempotencyConflictError(
      'Email delivery outcome is uncertain after an earlier attempt; not sending again',
      false,
    );
  }

  let messageId: string | undefined;
  try {
    const sent = await options.dispatch();
    if (!sent.messageId) {
      throw new SesRetryableError('SES did not return a message id', {
        code: 'SES_MESSAGE_ID_MISSING',
      });
    }
    messageId = sent.messageId;
    await options.store.markSent(options.claim.idempotencyKey, messageId);
    return { messageId, duplicate: false, status: DELIVERY_STATUS.SENT };
  } catch (error) {
    if (!messageId) {
      const failure = classifySendFailure(error);
      try {
        await options.store.markFailed(
          options.claim.idempotencyKey,
          failure.failureClass,
          failure.code,
        );
      } catch (persistError) {
        getLogger().error('email_delivery_status_persist_failed', persistError, {
          errorCode: 'DELIVERY_STORE_ERROR',
        });
      }
    }
    throw error;
  }
}

function classifySendFailure(error: unknown): {
  failureClass: (typeof FAILURE_CLASS)[keyof typeof FAILURE_CLASS];
  code: string;
} {
  const ses = sesFailure(error);
  if (ses instanceof SesPermanentError) {
    return { failureClass: FAILURE_CLASS.PERMANENT, code: ses.code };
  }
  if (ses instanceof SesRetryableError) {
    return { failureClass: FAILURE_CLASS.RETRYABLE, code: ses.code };
  }
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : error instanceof Error && error.name
        ? error.name
        : 'SEND_FAILED';
  return { failureClass: FAILURE_CLASS.RETRYABLE, code };
}

function sesFailure(error: unknown): SesPermanentError | SesRetryableError | undefined {
  if (error instanceof SesPermanentError || error instanceof SesRetryableError) {
    return error;
  }
  if (!isSesProviderError(error)) {
    return undefined;
  }
  return classifySesError(error);
}

function isSesProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  if ('$metadata' in error) {
    return true;
  }
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  return name.length > 0 && name !== 'Error';
}
