export type WhatsAppMessageType = 'text' | 'interactive' | 'button' | 'image' | 'unknown';

export interface IncomingMessage {
  messageId: string;
  from: string;
  timestamp?: string;
  type: WhatsAppMessageType;
  text?: string;
  interactiveId?: string;
  interactiveTitle?: string;
}

export interface StatusEvent {
  eventId: string;
  messageId?: string;
  status?: string;
  recipientId?: string;
  timestamp?: string;
}

export interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<Record<string, unknown>>;
        statuses?: Array<Record<string, unknown>>;
      };
    }>;
  }>;
}

export interface SendMessageRequest {
  to: string;
  type: 'text' | 'interactive' | 'template';
  text?: string;
  interactive?: Record<string, unknown>;
  template?: Record<string, unknown>;
}

export interface InboundEnvelope {
  correlationId: string;
  receivedAt: string;
  payload: WhatsAppWebhookPayload;
}
