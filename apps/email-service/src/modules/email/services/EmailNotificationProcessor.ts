import { getLogger } from '@api-hub/observability';

import type { EmailDeliveryConfig } from '../config/email-delivery-config.js';
import { readEmailDeliveryConfig } from '../config/email-delivery-config.js';
import type { EmailNotificationCommand } from '../domain/email-notification-command.js';
import { DELIVERY_STATUS } from '../domain/delivery-status.js';
import {
  EmailValidationError,
  SesPermanentError,
  SesRetryableError,
  TemplateInactiveError,
  TemplateNotFoundError,
  TemplateParameterValidationError,
  TemplateRenderError,
} from '../domain/errors.js';
import { recipientHash } from '../domain/template-catalog.js';
import { sendWithDeliveryTracking } from '../delivery/send-with-delivery-tracking.js';
import type { EmailDeliveryStore } from '../idempotency/email-delivery-store.js';
import { EMAIL_METRIC, type EmailMetrics } from '../observability/email-metrics.js';
import type { SesEmailSender } from '../ses/ses-email-sender.js';
import { TemplateParameterValidator } from '../templates/template-parameter-validator.js';
import { TemplateRenderer } from '../templates/template-renderer.js';
import type { TemplateResolver } from '../templates/template-resolver.js';

export type EmailDeliveryResult = {
  messageId: string;
  duplicate: boolean;
};

export class EmailNotificationProcessor {
  constructor(
    private readonly resolver: TemplateResolver,
    private readonly parameterValidator: TemplateParameterValidator,
    private readonly renderer: TemplateRenderer,
    private readonly deliveryStore: EmailDeliveryStore,
    private readonly sender: SesEmailSender,
    private readonly metrics: EmailMetrics,
    private readonly config: EmailDeliveryConfig = readEmailDeliveryConfig(),
  ) {}

  async deliver(command: EmailNotificationCommand): Promise<EmailDeliveryResult> {
    const started = Date.now();
    const hash = recipientHash(command.recipient.email);
    const log = getLogger({
      eventId: command.eventId,
      eventType: command.eventType,
      source: command.source,
      correlationId: command.correlationId,
      templateName: command.templateName,
      recipientHash: hash,
    });
    this.metrics.count(EMAIL_METRIC.EVENTS_CONSUMED);

    try {
      const template = await this.resolver.resolve({
        templateName: command.templateName,
        locale: command.locale,
        templateVersion: command.templateVersion,
      });
      log.info('email_template_resolved', {
        vendorId: command.parameters.vendorId,
        templateName: command.templateName,
      });
      this.parameterValidator.validate({
        templateName: command.templateName,
        subject: template.subject,
        htmlContent: template.htmlContent,
        textContent: template.textContent,
        declarations: template.parameters,
        parameters: command.parameters,
      });
      const optional = new Set(
        template.parameters.filter((parameter) => !parameter.required).map((parameter) => parameter.name),
      );
      const rendered = this.renderer.render({
        templateName: command.templateName,
        subject: template.subject,
        htmlContent: template.htmlContent,
        textContent: template.textContent,
        parameters: command.parameters,
        optionalParameters: optional,
        unsubscribeUrl: this.config.unsubscribeUrl,
      });

      const tracked = await sendWithDeliveryTracking({
        store: this.deliveryStore,
        claim: {
          idempotencyKey: command.idempotencyKey,
          eventId: command.eventId,
          eventType: command.eventType,
          source: command.source,
          correlationId: command.correlationId,
          templateName: command.templateName,
          recipientHash: hash,
        },
        dispatch: async () => {
          log.info('email_send_started', {
            vendorId: command.parameters.vendorId,
            templateName: command.templateName,
          });
          this.metrics.count(EMAIL_METRIC.EMAILS_REQUESTED);
          return this.sender.dispatch({
            fromEmail: this.config.fromEmail,
            fromName: this.config.fromName,
            replyTo: this.config.replyTo,
            to: [command.recipient.email],
            cc: command.cc,
            bcc: command.bcc,
            rendered,
            configurationSetName: this.config.configurationSetName,
            eventId: command.eventId,
            idempotencyKey: command.idempotencyKey,
            templateName: command.templateName,
          });
        },
      });

      if (tracked.duplicate) {
        this.metrics.count(EMAIL_METRIC.DUPLICATE_SKIPS);
        log.info('email_duplicate_skipped', {
          status: tracked.status,
          messageId: tracked.messageId,
          durationMs: Date.now() - started,
        });
        return { messageId: tracked.messageId, duplicate: true };
      }

      this.metrics.count(EMAIL_METRIC.SES_SUCCESS);
      log.info('email_send_succeeded', {
        status: DELIVERY_STATUS.SENT,
        messageId: tracked.messageId,
        durationMs: Date.now() - started,
      });
      return { messageId: tracked.messageId, duplicate: false };
    } catch (error) {
      this.recordFailureMetric(error);
      const code = errorCode(error);
      getLogger({
        eventId: command.eventId,
        eventType: command.eventType,
        source: command.source,
        correlationId: command.correlationId,
        templateName: command.templateName,
        recipientHash: hash,
      }).error('email_delivery_failed', error, {
        status: 'failed',
        errorCode: code,
        durationMs: Date.now() - started,
      });
      log.error('email_send_failed', error, {
        vendorId: command.parameters.vendorId,
        templateName: command.templateName,
        errorCode: code,
      });
      throw error;
    } finally {
      this.metrics.latency(Date.now() - started);
    }
  }

  private recordFailureMetric(error: unknown): void {
    if (error instanceof TemplateNotFoundError) {
      this.metrics.count(EMAIL_METRIC.TEMPLATE_NOT_FOUND);
      return;
    }
    if (error instanceof TemplateParameterValidationError) {
      this.metrics.count(EMAIL_METRIC.PARAMETER_VALIDATION_FAILURES);
      return;
    }
    if (error instanceof TemplateRenderError) {
      this.metrics.count(EMAIL_METRIC.RENDERING_FAILURES);
      return;
    }
    if (error instanceof EmailValidationError || error instanceof TemplateInactiveError) {
      this.metrics.count(EMAIL_METRIC.VALIDATION_FAILURES);
      return;
    }
    if (error instanceof SesPermanentError || error instanceof SesRetryableError) {
      this.metrics.count(EMAIL_METRIC.SES_FAILURE);
    }
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  if (error instanceof Error) {
    return error.name;
  }
  return 'UNKNOWN';
}
