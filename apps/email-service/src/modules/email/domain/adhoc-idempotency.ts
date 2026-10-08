import { sha256Hex, stableStringify } from '@api-hub/utils';

import type { AdhocEmailRequest } from './types.js';

export type AdhocDeliveryContext = {
  idempotencyKey?: string;
  correlationId?: string;
  eventId?: string;
  eventType?: string;
  source?: string;
};

/**
 * Caller-supplied Idempotency-Key wins.
 * Otherwise the key is a hash of the send payload so a retry of the same request
 * reuses the claim. A fresh random key on each attempt would send the email again.
 */
export function resolveAdhocIdempotencyKey(
  request: AdhocEmailRequest,
  context?: AdhocDeliveryContext,
): string {
  const explicit = context?.idempotencyKey?.trim();
  if (explicit) {
    return explicit;
  }
  return `adhoc:${sha256Hex(stableStringify(adhocIdempotencyPayload(request)))}`;
}

export function readCallerIdempotencyKey(
  headers?: Record<string, string | undefined> | null,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    if (
      (normalized === 'idempotency-key' || normalized === 'x-idempotency-key') &&
      typeof value === 'string' &&
      value.trim().length > 0
    ) {
      return value.trim();
    }
  }
  return undefined;
}

function adhocIdempotencyPayload(request: AdhocEmailRequest) {
  return {
    to: request.to,
    from: request.from,
    fromName: request.fromName ?? '',
    subject: request.subject ?? '',
    htmlContent: request.htmlContent ?? '',
    textContent: request.textContent ?? '',
    templateName: request.templateName ?? '',
    templateData: request.templateData ?? {},
    cc: request.cc ?? [],
    bcc: request.bcc ?? [],
    replyTo: request.replyTo ?? [],
    attachments: (request.attachments ?? []).map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      content: attachment.content,
    })),
    contactListName: request.contactListName ?? '',
    topicName: request.topicName ?? '',
  };
}
