import type {
  BaseEvent,
  BookingConfirmedPayload,
  EmailNotificationRequestedPayload,
  VendorEmailVerificationRequestedPayload,
  VendorOnboardingSubmittedPayload,
} from '@api-hub/event-platform';

import { resolveNotificationTemplateName } from '../domain/notification-templates.js';
import {
  BOOKING_CONFIRMED_EVENT_TYPE,
  VENDOR_EMAIL_VERIFICATION_EVENT_TYPE,
  VENDOR_ONBOARDING_EVENT_TYPE,
} from '@api-hub/event-platform';
import type {
  EmailNotificationCommand,
  EnvelopeIdentity,
} from '../domain/email-notification-command.js';
import { EmailValidationError } from '../domain/errors.js';
import { environment } from '../../../common/config/environment.js';

export function asEnvelope(value: unknown): EnvelopeIdentity {
  if (!value || typeof value !== 'object') {
    throw new EmailValidationError('Email event envelope is missing');
  }
  const event = value as BaseEvent;
  if (!event.eventId || !event.eventType || !event.source || !event.timestamp || !event.idempotencyKey) {
    throw new EmailValidationError('Email event envelope is incomplete');
  }
  return event;
}

export function commandFromEmailNotification(
  payload: EmailNotificationRequestedPayload & { meta?: { correlationId?: string } },
  envelope: EnvelopeIdentity,
): EmailNotificationCommand {
  return {
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    source: envelope.source,
    occurredAt: envelope.timestamp,
    correlationId: payload.meta?.correlationId ?? envelope.meta?.correlationId,
    idempotencyKey: envelope.idempotencyKey,
    templateName: payload.templateName,
    locale: payload.locale,
    templateVersion: payload.templateVersion,
    recipient: payload.recipient,
    cc: payload.cc,
    bcc: payload.bcc,
    parameters: payload.parameters,
  };
}

export function adaptVendorOnboardingSubmitted(
  payload: VendorOnboardingSubmittedPayload & { meta?: { correlationId?: string } },
  envelope: EnvelopeIdentity,
): EmailNotificationCommand {
  return baseCommand(envelope, payload.meta?.correlationId, payload.email, undefined, {
    applicationId: payload.applicationId,
    vendorId: payload.vendorId,
    ...(payload.businessName ? { businessName: payload.businessName } : {}),
  }, VENDOR_ONBOARDING_EVENT_TYPE);
}

export function adaptVendorEmailVerificationRequested(
  payload: VendorEmailVerificationRequestedPayload & { meta?: { correlationId?: string } },
  envelope: EnvelopeIdentity,
): EmailNotificationCommand {
  return baseCommand(envelope, payload.meta?.correlationId, payload.email, payload.ownerName, {
    vendorId: payload.vendorId,
    ownerName: payload.ownerName,
    businessName: payload.businessName,
    verificationUrl: vendorVerificationUrl(payload.verificationToken),
  }, VENDOR_EMAIL_VERIFICATION_EVENT_TYPE);
}

/** Builds the frontend link without ever logging its opaque bearer token. */
function vendorVerificationUrl(token: string): string {
  const configured = environment.vendorEmailVerificationUrl.trim();
  if (!configured) {
    throw new EmailValidationError('VENDOR_EMAIL_VERIFICATION_URL is not configured');
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new EmailValidationError('VENDOR_EMAIL_VERIFICATION_URL is not a valid URL');
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new EmailValidationError('VENDOR_EMAIL_VERIFICATION_URL must use HTTP(S)');
  }
  url.searchParams.set('token', token);
  return url.toString();
}

export function adaptBookingConfirmed(
  payload: BookingConfirmedPayload & { meta?: { correlationId?: string } },
  envelope: EnvelopeIdentity,
): EmailNotificationCommand {
  return baseCommand(
    envelope,
    payload.meta?.correlationId,
    payload.customerEmail,
    payload.customerName,
    {
      bookingId: payload.bookingId,
      vendorId: payload.vendorId,
      bookingDate: payload.bookingDate,
      slotId: payload.slotId,
      ...(payload.customerName ? { customerName: payload.customerName } : {}),
      ...(payload.vendorName ? { vendorName: payload.vendorName } : {}),
      ...(payload.totalAmount !== undefined ? { totalAmount: payload.totalAmount } : {}),
    },
    BOOKING_CONFIRMED_EVENT_TYPE,
  );
}

function baseCommand(
  envelope: EnvelopeIdentity,
  correlationId: string | undefined,
  email: string,
  name: string | undefined,
  parameters: Record<string, unknown>,
  eventType: string,
): EmailNotificationCommand {
  return {
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    source: envelope.source,
    occurredAt: envelope.timestamp,
    correlationId: correlationId ?? envelope.meta?.correlationId,
    idempotencyKey: envelope.idempotencyKey,
    templateName: resolveNotificationTemplateName(eventType),
    recipient: {
      email,
      ...(name ? { name } : {}),
    },
    parameters,
  };
}
