import { createServer } from 'node:http';
import { createLogger } from '@api-hub/observability';
import { loadConfig } from './config/env';
import { ConversationFlow } from './flows/conversation.flow';
import { loadWhatsAppCredentials } from './infra/secrets';
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
import { InMemoryConversationStore } from './repositories/conversation.repository';
import { WhatsAppChannelService } from './services/channel.service';
import { CustomerChannelService } from './services/customer-channel.service';
import { handleHttpRequest, healthResponse, HttpRequest, isHealthRequest, WebhookRuntime } from './services/webhook-http';

const config = loadConfig();
const port = config.port;
const logger = createLogger({ service: 'whatsapp-channel-service', redactPII: true });
let runtimePromise: Promise<WebhookRuntime> | undefined;

function localRuntime(): Promise<WebhookRuntime> {
  if (!runtimePromise) {
    runtimePromise = buildLocalRuntime().catch((error: unknown) => {
      runtimePromise = undefined;
      throw error;
    });
  }
  return runtimePromise;
}

async function buildLocalRuntime(): Promise<WebhookRuntime> {
  const credentials = await loadWhatsAppCredentials(config);
  const store = new InMemoryConversationStore();
  const meta = new MetaWhatsAppProvider({
    apiVersion: config.apiVersion,
    phoneNumberId: credentials.phoneNumberId,
    businessAccountId: credentials.businessAccountId,
    accessToken: credentials.accessToken,
    appSecret: credentials.appSecret,
    verifyToken: config.verifyToken,
    timeoutMs: config.downstreamTimeoutMs,
  });
  const token = config.serviceAuthToken;
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
  return {
    verifyWebhook: (mode, verifyToken, challenge) => meta.verifyWebhook(mode, verifyToken, challenge),
    verifySignature: (rawBody, signature) => meta.verifySignature(rawBody, signature),
    processInline: true,
    processWebhook: (payload, correlationId) => channel.processWebhook(payload, correlationId),
    enqueue: async (envelope) => {
      await channel.processWebhook(envelope.payload, envelope.correlationId);
    },
  };
}

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

  try {
    const response = isHealthRequest(request)
      ? healthResponse(request.headers['x-correlation-id'])
      : await handleHttpRequest(request, await localRuntime());
    res.writeHead(response.statusCode, response.headers);
    res.end(response.body);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'Error';
    logger.error({ event: 'local_request_failed', errorName });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      statusCode: 500,
      message: { title: 'Error', description: 'Request failed', severity: 'ERROR' },
    }));
  }
}).listen(port, () => {
  logger.info({ event: 'whatsapp_channel_listening', port });
});
