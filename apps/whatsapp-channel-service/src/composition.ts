import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { createChildLogger, createLogger } from '@api-hub/observability';
import { loadConfig } from './config/env';
import { ConversationFlow } from './flows/conversation.flow';
import { DynamoConversationStore } from './repositories/conversation.repository';
import { loadMetaCredentials, loadServiceAuthToken } from './infra/secrets';
import { MetaWhatsAppProvider } from './providers/meta-whatsapp.provider';
import {
  HttpAvailabilityClient,
  HttpBookingClient,
  HttpCatalogClient,
  HttpPricingClient,
  HttpUserClient,
  HttpVehicleClient,
  HttpVendorClient,
} from './providers/domain.providers';
import { WhatsAppChannelService } from './services/channel.service';
import { CustomerChannelService } from './services/customer-channel.service';
import { InboundEnvelope } from './types/whatsapp';
import { WebhookRuntime } from './services/webhook-http';

const logger = createChildLogger(createLogger({ service: 'whatsapp-channel-service', redactPII: true }), {
  component: 'composition',
});

let runtimePromise: Promise<WebhookRuntime> | undefined;

export function getWebhookRuntime(): Promise<WebhookRuntime> {
  if (!runtimePromise) runtimePromise = buildRuntime();
  return runtimePromise;
}

async function buildRuntime(): Promise<WebhookRuntime> {
  const config = loadConfig();
  if (!config.businessAccountId) {
    logger.warn({ event: 'whatsapp_business_account_missing' });
  }
  if (!config.conversationTable) {
    throw new Error('WHATSAPP_CONVERSATION_TABLE is required');
  }
  const credentials = await loadMetaCredentials(config);
  const token = await loadServiceAuthToken(config);
  const store = new DynamoConversationStore(config.conversationTable);
  const meta = new MetaWhatsAppProvider({
    apiVersion: config.apiVersion,
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId,
    accessToken: credentials.accessToken,
    appSecret: credentials.appSecret,
    verifyToken: config.verifyToken,
    timeoutMs: config.downstreamTimeoutMs,
  });
  const customers = new CustomerChannelService(store, HttpUserClient.fromConfig(config, token), config.customerLinks);
  const flow = new ConversationFlow(
    store,
    meta,
    HttpCatalogClient.fromConfig(config, token),
    HttpAvailabilityClient.fromConfig(config, token),
    HttpPricingClient.fromConfig(config, token),
    HttpBookingClient.fromConfig(config, token),
    HttpVehicleClient.fromConfig(config, token),
    HttpVendorClient.fromConfig(config, token),
    customers,
    config,
  );
  const channel = new WhatsAppChannelService(store, meta, flow, customers);
  const queue = config.inboundQueueUrl ? new SQSClient({ region: config.region }) : undefined;

  return {
    verifyWebhook: (mode, verifyToken, challenge) => meta.verifyWebhook(mode, verifyToken, challenge),
    verifySignature: (rawBody, signature) => meta.verifySignature(rawBody, signature),
    processInline: config.processInline || !config.inboundQueueUrl,
    processWebhook: (payload, correlationId) => channel.processWebhook(payload, correlationId),
    enqueue: async (envelope: InboundEnvelope) => {
      if (!queue || !config.inboundQueueUrl) {
        await channel.processWebhook(envelope.payload, envelope.correlationId);
        return;
      }
      // SQS, not DynamoDB. The shared lint rule treats every client.send() call as a table access.
      // eslint-disable-next-line mvrx/no-direct-dynamodb
      await queue.send(new SendMessageCommand({
        QueueUrl: config.inboundQueueUrl,
        MessageBody: JSON.stringify(envelope),
      }));
    },
  };
}

export function resetRuntimeForTests(): void {
  runtimePromise = undefined;
}
