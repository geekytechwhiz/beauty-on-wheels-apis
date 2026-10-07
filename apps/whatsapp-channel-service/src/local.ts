import { createServer } from 'node:http';
import { createLogger } from '@api-hub/observability';
import { loadConfig } from './config/env';
import { ConversationFlow } from './flows/conversation.flow';
import { InMemoryConversationStore } from './repositories/conversation.repository';
import { handleHttpRequest, HttpRequest } from './services/webhook-http';
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

const config = loadConfig();
const store = new InMemoryConversationStore();
const meta = new MetaWhatsAppProvider({
  apiVersion: config.apiVersion,
  phoneNumberId: config.phoneNumberId,
  businessAccountId: config.businessAccountId,
  accessToken: config.accessToken ?? 'local-token',
  appSecret: config.appSecret ?? 'local-secret',
  verifyToken: config.verifyToken,
  timeoutMs: config.downstreamTimeoutMs,
});
const customers = new CustomerChannelService(store, HttpUserClient.fromConfig(config, config.serviceAuthToken), config.customerLinks);
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
const channel = new WhatsAppChannelService(store, meta, flow, customers);
const port = config.port;
const logger = createLogger({ service: 'whatsapp-channel-service', redactPII: true });

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(value) ? value[0] : value;
  }
  const request: HttpRequest = {
    method: (req.method ?? 'GET').toUpperCase(),
    path: url.pathname,
    rawBody: Buffer.concat(chunks).toString('utf8'),
    headers,
    query: Object.fromEntries(url.searchParams.entries()),
  };
  const response = await handleHttpRequest(request, {
    verifyWebhook: (mode, token, challenge) => meta.verifyWebhook(mode, token, challenge),
    verifySignature: (rawBody, signature) => meta.verifySignature(rawBody, signature),
    processInline: true,
    processWebhook: (payload, correlationId) => channel.processWebhook(payload, correlationId),
    enqueue: async (envelope) => {
      await channel.processWebhook(envelope.payload, envelope.correlationId);
    },
  });
  res.writeHead(response.statusCode, response.headers);
  res.end(response.body);
}).listen(port, () => {
  logger.info({ event: 'whatsapp_channel_listening', port });
});
