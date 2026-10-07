import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ChannelConfig, loadConfig } from './config/env';
import { ConversationFlow } from './flows/conversation.flow';
import { loadWhatsAppCredentials, WhatsAppCredentials } from './infra/secrets';
import { MetaClientConfig, MetaWhatsAppProvider } from './providers/meta-whatsapp.provider';
import {
  HttpAvailabilityClient,
  HttpBookingClient,
  HttpCatalogClient,
  HttpPricingClient,
  HttpUserClient,
  HttpVehicleClient,
  HttpVendorClient,
} from './providers/domain.providers';
import { DynamoConversationStore } from './repositories/conversation.repository';
import { WhatsAppChannelService } from './services/channel.service';
import { CustomerChannelService } from './services/customer-channel.service';
import { WebhookRuntime } from './services/webhook-http';
import { InboundEnvelope } from './types/whatsapp';

let runtime: WebhookRuntime | undefined;

function toMetaConfig(config: ChannelConfig, credentials: WhatsAppCredentials): MetaClientConfig {
  return {
    apiVersion: config.apiVersion,
    phoneNumberId: credentials.phoneNumberId,
    businessAccountId: credentials.businessAccountId,
    accessToken: credentials.accessToken,
    appSecret: credentials.appSecret,
    verifyToken: config.verifyToken,
    timeoutMs: config.downstreamTimeoutMs,
  };
}

async function createChannel(
  config: ChannelConfig,
  metaProvider: () => Promise<MetaWhatsAppProvider>,
): Promise<WhatsAppChannelService> {
  if (!config.conversationTable) {
    throw new Error('WHATSAPP_CONVERSATION_TABLE is required');
  }
  const meta = await metaProvider();
  const store = new DynamoConversationStore(config.conversationTable);
  const customers = new CustomerChannelService(
    store,
    HttpUserClient.fromConfig(config, config.serviceAuthToken),
    config.customerLinks,
  );
  const flow = new ConversationFlow(
    store,
    meta,
    HttpCatalogClient.fromConfig(config, config.serviceAuthToken),
    HttpAvailabilityClient.fromConfig(config, config.serviceAuthToken),
    HttpPricingClient.fromConfig(config, config.serviceAuthToken),
    HttpBookingClient.fromConfig(config, config.serviceAuthToken),
    HttpVehicleClient.fromConfig(config, config.serviceAuthToken),
    HttpVendorClient.fromConfig(config, config.serviceAuthToken),
    customers,
    config,
  );
  return new WhatsAppChannelService(store, meta, flow, customers);
}

function buildRuntime(): WebhookRuntime {
  const config = loadConfig();
  let metaPromise: Promise<MetaWhatsAppProvider> | undefined;
  let channelPromise: Promise<WhatsAppChannelService> | undefined;
  const queue = config.inboundQueueUrl ? new SQSClient({ region: config.region }) : undefined;

  const metaProvider = (): Promise<MetaWhatsAppProvider> => {
    if (!metaPromise) {
      metaPromise = loadWhatsAppCredentials(config)
        .then((credentials) => new MetaWhatsAppProvider(toMetaConfig(config, credentials)))
        .catch((error: unknown) => {
          metaPromise = undefined;
          throw error;
        });
    }
    return metaPromise;
  };

  const channel = (): Promise<WhatsAppChannelService> => {
    if (!channelPromise) {
      channelPromise = createChannel(config, metaProvider).catch((error: unknown) => {
        channelPromise = undefined;
        throw error;
      });
    }
    return channelPromise;
  };

  return {
    verifyWebhook(mode, verifyToken, challenge) {
      if (!config.verifyToken) return null;
      if (mode === 'subscribe' && verifyToken === config.verifyToken && challenge) return challenge;
      return null;
    },
    verifySignature: async (rawBody, signature) => (await metaProvider()).verifySignature(rawBody, signature),
    processInline: config.processInline || !config.inboundQueueUrl,
    processWebhook: async (payload, correlationId) => (await channel()).processWebhook(payload, correlationId),
    enqueue: async (envelope: InboundEnvelope) => {
      if (!queue || !config.inboundQueueUrl) {
        await (await channel()).processWebhook(envelope.payload, envelope.correlationId);
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

export function getWebhookRuntime(): Promise<WebhookRuntime> {
  if (!runtime) runtime = buildRuntime();
  return Promise.resolve(runtime);
}

export function resetRuntimeForTests(): void {
  runtime = undefined;
}
