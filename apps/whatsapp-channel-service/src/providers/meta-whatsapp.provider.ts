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
    await this.sendText(to, text);
  }

  async sendText(to: string, text: string): Promise<{ messageId: string }> {
    const payload = await this.deliver({ to, type: 'text', text: text.slice(0, 4096) });
    const messageId = readMessageId(payload);
    if (!messageId) {
      throw new ChannelError(CHANNEL_ERROR_CODE.META_API_ERROR, 'Meta WhatsApp API did not return a message id');
    }
    return { messageId };
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

  private async deliver(request: SendMessageRequest): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: request.to,
      type: request.type,
    };
    if (request.type === 'text') body.text = { preview_url: false, body: request.text ?? '' };
    if (request.type === 'interactive') body.interactive = request.interactive;
    if (request.type === 'template') body.template = request.template;
    const payload = await this.post(body);
    if (readMessageId(payload)) recordMetric(WHATSAPP_METRIC.MESSAGES_SENT);
    return payload;
  }

  private assertReady(): void {
    if (!this.config.accessToken.trim()) {
      throw new ChannelError(CHANNEL_ERROR_CODE.WHATSAPP_CONFIG_MISSING, 'WhatsApp access token is not configured', {
        metadata: { field: 'WHATSAPP_ACCESS_TOKEN' },
      });
    }
    if (!this.config.phoneNumberId.trim()) {
      throw new ChannelError(CHANNEL_ERROR_CODE.WHATSAPP_CONFIG_MISSING, 'WhatsApp phone number id is not configured', {
        metadata: { field: 'WHATSAPP_PHONE_NUMBER_ID' },
      });
    }
    if (!this.config.apiVersion.trim()) {
      throw new ChannelError(CHANNEL_ERROR_CODE.WHATSAPP_CONFIG_MISSING, 'WhatsApp API version is not configured', {
        metadata: { field: 'WHATSAPP_API_VERSION' },
      });
    }
  }

  private redact(value: string): string {
    let text = value.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
    const token = this.config.accessToken;
    if (token) text = text.split(token).join('[REDACTED]');
    return text.slice(0, 300);
  }

  private async post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertReady();
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
      const name = error instanceof Error ? error.name : 'Error';
      logger.error({ event: 'meta_api_failed', errorName: name });
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ChannelError(CHANNEL_ERROR_CODE.TIMEOUT, 'Meta WhatsApp API timed out', { retryable: true });
      }
      throw new ChannelError(CHANNEL_ERROR_CODE.META_API_ERROR, 'Meta WhatsApp API request failed', { retryable: true });
    }

    const raw = await readBody(response);
    if (!response.ok) {
      recordMetric(WHATSAPP_METRIC.META_API_FAILED);
      const metaError = readMetaError(raw);
      const retryable = response.status === 429 || response.status >= 500;
      logger.error({
        event: 'meta_api_failed',
        status: response.status,
        retryable,
        metaErrorCode: metaError.code,
        metaErrorType: metaError.type,
        metaErrorMessage: metaError.message ? this.redact(metaError.message) : undefined,
      });
      if (response.status === 401) {
        throw new ChannelError(CHANNEL_ERROR_CODE.AUTHENTICATION_ERROR, 'Meta WhatsApp API rejected the request');
      }
      if (response.status === 403) {
        throw new ChannelError(CHANNEL_ERROR_CODE.AUTHORIZATION_ERROR, 'Meta WhatsApp API rejected the request');
      }
      throw new ChannelError(CHANNEL_ERROR_CODE.META_API_ERROR, `Meta WhatsApp API failed with status ${response.status}`, {
        retryable,
        metadata: { status: response.status },
      });
    }

    const payload = parseJsonObject(raw);
    logger.info({
      event: 'meta_api_response',
      status: response.status,
      messageId: readMessageId(payload) || undefined,
    });
    return payload;
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

async function readBody(response: Response): Promise<string> {
  if (typeof response.text !== 'function') return '';
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readMessageId(payload: Record<string, unknown>): string {
  const messages = payload.messages;
  if (!Array.isArray(messages)) return '';
  const first = messages[0];
  if (!first || typeof first !== 'object') return '';
  const id = (first as { id?: unknown }).id;
  return typeof id === 'string' ? id : '';
}

function readMetaError(raw: string): { code?: number | string; type?: string; message?: string } {
  const payload = parseJsonObject(raw);
  const error = payload.error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return {};
  const record = error as { code?: unknown; type?: unknown; message?: unknown };
  return {
    code: typeof record.code === 'number' || typeof record.code === 'string' ? record.code : undefined,
    type: typeof record.type === 'string' ? record.type : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  };
}
