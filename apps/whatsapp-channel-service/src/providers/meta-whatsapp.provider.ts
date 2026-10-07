import { createHmac, timingSafeEqual } from 'node:crypto';
import { createChildLogger, createLogger } from '@api-hub/observability';
import { ChannelError, CHANNEL_ERROR_CODE } from '../errors/channel-error';
import { recordMetric, WHATSAPP_METRIC } from '../infra/metrics';
import { IncomingMessage, SendMessageRequest, StatusEvent, WhatsAppWebhookPayload } from '../types/whatsapp';

const logger = createChildLogger(createLogger({ service: 'whatsapp-channel-service', redactPII: true }), {
  component: 'meta-whatsapp',
});

export interface MetaClientConfig {
  apiVersion: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  appSecret?: string;
  verifyToken: string;
  timeoutMs: number;
}

export interface ReplyButton {
  id: string;
  title: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export class MetaWhatsAppProvider {
  private readonly baseUrl: string;

  constructor(
    private readonly config: MetaClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = `https://graph.facebook.com/${config.apiVersion}`;
  }

  verifyWebhook(mode: string | undefined, token: string | undefined, challenge: string | undefined): string | null {
    if (!this.config.verifyToken) return null;
    if (mode === 'subscribe' && token === this.config.verifyToken && challenge) return challenge;
    return null;
  }

  verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
    const appSecret = this.config.appSecret;
    if (!appSecret) {
      logger.warn({ event: 'whatsapp_app_secret_missing' });
      return false;
    }
    if (!signatureHeader?.startsWith('sha256=')) return false;
    const provided = signatureHeader.slice('sha256='.length);
    if (!/^[0-9a-f]+$/i.test(provided) || provided.length % 2 !== 0) return false;
    const actual = Buffer.from(provided, 'hex');
    const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }

  parseMessages(payload: WhatsAppWebhookPayload): IncomingMessage[] {
    const result: IncomingMessage[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          result.push(this.parseMessage(message));
        }
      }
    }
    return result.filter((message) => message.messageId && message.from);
  }

  parseStatuses(payload: WhatsAppWebhookPayload): StatusEvent[] {
    const result: StatusEvent[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const status of change.value?.statuses ?? []) {
          const id = typeof status.id === 'string' ? status.id : '';
          const state = typeof status.status === 'string' ? status.status : 'unknown';
          if (!id) continue;
          result.push({
            eventId: `${id}:${state}:${typeof status.timestamp === 'string' ? status.timestamp : ''}`,
            messageId: id,
            status: state,
            recipientId: typeof status.recipient_id === 'string' ? status.recipient_id : undefined,
            timestamp: typeof status.timestamp === 'string' ? status.timestamp : undefined,
          });
        }
      }
    }
    return result;
  }

  async text(to: string, text: string): Promise<void> {
    await this.deliver({ to, type: 'text', text: text.slice(0, 4096) });
  }

  async buttons(to: string, body: string, buttons: ReplyButton[]): Promise<void> {
    await this.deliver({
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body.slice(0, 1024) },
        action: {
          buttons: buttons.slice(0, 3).map((button) => ({
            type: 'reply',
            reply: { id: button.id.slice(0, 256), title: button.title.slice(0, 20) },
          })),
        },
      },
    });
  }

  async list(to: string, body: string, buttonText: string, rows: ListRow[]): Promise<void> {
    if (rows.length === 0) {
      throw new ChannelError(CHANNEL_ERROR_CODE.VALIDATION_ERROR, 'Cannot send an empty WhatsApp list');
    }
    await this.deliver({
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body.slice(0, 1024) },
        action: {
          button: buttonText.slice(0, 20),
          sections: [{
            title: 'Options',
            rows: rows.slice(0, 10).map((row) => ({
              id: row.id.slice(0, 200),
              title: row.title.slice(0, 24),
              description: row.description?.slice(0, 72),
            })),
          }],
        },
      },
    });
  }

  async template(to: string, name: string, language: string, parameters: Array<{ type: 'text'; text: string }>): Promise<void> {
    await this.deliver({
      to,
      type: 'template',
      template: {
        name,
        language: { code: language },
        components: parameters.length ? [{ type: 'body', parameters }] : [],
      },
    });
  }

  async markRead(messageId: string): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  }

  private async deliver(request: SendMessageRequest): Promise<void> {
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: request.to,
      type: request.type,
    };
    if (request.type === 'text') body.text = { preview_url: false, body: request.text ?? '' };
    if (request.type === 'interactive') body.interactive = request.interactive;
    if (request.type === 'template') body.template = request.template;
    await this.post(body);
    recordMetric(WHATSAPP_METRIC.MESSAGES_SENT);
  }

  private async post(body: Record<string, unknown>): Promise<void> {
    if (!this.config.phoneNumberId || !this.config.accessToken) {
      throw new ChannelError(CHANNEL_ERROR_CODE.META_API_ERROR, 'WhatsApp Cloud API credentials are not configured');
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${this.config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      recordMetric(WHATSAPP_METRIC.META_API_FAILED);
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ChannelError(CHANNEL_ERROR_CODE.TIMEOUT, 'Meta WhatsApp API timed out', { retryable: true });
      }
      throw new ChannelError(CHANNEL_ERROR_CODE.META_API_ERROR, 'Meta WhatsApp API request failed', { retryable: true });
    }

    if (!response.ok) {
      recordMetric(WHATSAPP_METRIC.META_API_FAILED);
      const retryable = response.status === 429 || response.status >= 500;
      logger.error({ event: 'meta_api_failed', status: response.status, retryable });
      if (response.status === 401 || response.status === 403) {
        throw new ChannelError(CHANNEL_ERROR_CODE.AUTHENTICATION_ERROR, 'Meta WhatsApp API rejected the access token');
      }
      throw new ChannelError(CHANNEL_ERROR_CODE.META_API_ERROR, `Meta WhatsApp API failed with status ${response.status}`, {
        retryable,
        metadata: { status: response.status },
      });
    }
  }

  private parseMessage(message: Record<string, unknown>): IncomingMessage {
    const type = typeof message.type === 'string' ? message.type : 'unknown';
    const base = {
      messageId: typeof message.id === 'string' ? message.id : '',
      from: typeof message.from === 'string' ? message.from : '',
      timestamp: typeof message.timestamp === 'string' ? message.timestamp : undefined,
    };
    if (type === 'text') {
      const text = message.text as { body?: string } | undefined;
      return { ...base, type: 'text', text: text?.body };
    }
    if (type === 'interactive') {
      const interactive = message.interactive as {
        button_reply?: { id?: string; title?: string };
        list_reply?: { id?: string; title?: string };
      } | undefined;
      return {
        ...base,
        type: 'interactive',
        interactiveId: interactive?.button_reply?.id ?? interactive?.list_reply?.id,
        interactiveTitle: interactive?.button_reply?.title ?? interactive?.list_reply?.title,
      };
    }
    if (type === 'button') {
      const button = message.button as { payload?: string; text?: string } | undefined;
      return { ...base, type: 'button', interactiveId: button?.payload, interactiveTitle: button?.text };
    }
    return { ...base, type: type === 'image' ? 'image' : 'unknown' };
  }
}
