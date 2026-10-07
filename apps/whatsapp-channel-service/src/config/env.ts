import { z } from 'zod';

const schema = z.object({
  STAGE: z.string().default('dev'),
  DEFAULT_AWS_REGION: z.string().default('us-east-1'),
  WHATSAPP_API_VERSION: z.string().default('v25.0'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().default(''),
  WHATSAPP_SECRET_NAME: z.string().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_CONVERSATION_TABLE: z.string().default(''),
  CATALOG_SERVICE_URL: z.string().default(''),
  AVAILABILITY_SERVICE_URL: z.string().default(''),
  PRICING_SERVICE_URL: z.string().default(''),
  BOOKING_SERVICE_URL: z.string().default(''),
  USER_SERVICE_URL: z.string().default(''),
  VEHICLE_SERVICE_URL: z.string().default(''),
  VENDOR_SERVICE_URL: z.string().default(''),
  SERVICE_AUTH_TOKEN: z.string().optional(),
  CONVERSATION_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  DOWNSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  WHATSAPP_PROCESS_INLINE: z.enum(['true', 'false']).default('false'),
  INBOUND_QUEUE_URL: z.string().default(''),
  WHATSAPP_PILOT_VENDOR_IDS: z.string().default(''),
  WHATSAPP_BUSINESS_NAME: z.string().default('Beauty on Wheels'),
  WHATSAPP_CUSTOMER_LINKS: z.string().default(''),
  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),
  PORT: z.coerce.number().int().positive().default(4010),
});

export interface ChannelConfig {
  stage: string;
  region: string;
  apiVersion: string;
  phoneNumberId: string;
  businessAccountId: string;
  verifyToken: string;
  whatsappSecretName: string;
  accessToken?: string;
  appSecret?: string;
  conversationTable: string;
  catalogServiceUrl: string;
  availabilityServiceUrl: string;
  pricingServiceUrl: string;
  bookingServiceUrl: string;
  userServiceUrl: string;
  vehicleServiceUrl: string;
  vendorServiceUrl: string;
  serviceAuthToken?: string;
  conversationTtlSeconds: number;
  downstreamTimeoutMs: number;
  processInline: boolean;
  inboundQueueUrl: string;
  pilotVendorIds: string[];
  businessName: string;
  customerLinks: Record<string, string>;
  timezone: string;
  port: number;
}

let cached: ChannelConfig | undefined;

function blank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseLinks(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('WHATSAPP_CUSTOMER_LINKS must be a JSON object of phone digits to customerId');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('WHATSAPP_CUSTOMER_LINKS must be a JSON object of phone digits to customerId');
  }
  const links: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.trim()) links[key.replace(/\D/g, '')] = value.trim();
  }
  return links;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): ChannelConfig {
  if (cached && source === process.env) return cached;
  const parsed = schema.parse({
    STAGE: source.STAGE,
    DEFAULT_AWS_REGION: source.DEFAULT_AWS_REGION,
    WHATSAPP_API_VERSION: source.WHATSAPP_API_VERSION,
    WHATSAPP_PHONE_NUMBER_ID: source.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_BUSINESS_ACCOUNT_ID: source.WHATSAPP_BUSINESS_ACCOUNT_ID,
    WHATSAPP_VERIFY_TOKEN: source.WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_SECRET_NAME: source.WHATSAPP_SECRET_NAME,
    WHATSAPP_ACCESS_TOKEN: source.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_APP_SECRET: source.WHATSAPP_APP_SECRET,
    WHATSAPP_CONVERSATION_TABLE: source.WHATSAPP_CONVERSATION_TABLE,
    CATALOG_SERVICE_URL: source.CATALOG_SERVICE_URL,
    AVAILABILITY_SERVICE_URL: source.AVAILABILITY_SERVICE_URL,
    PRICING_SERVICE_URL: source.PRICING_SERVICE_URL,
    BOOKING_SERVICE_URL: source.BOOKING_SERVICE_URL,
    USER_SERVICE_URL: source.USER_SERVICE_URL,
    VEHICLE_SERVICE_URL: source.VEHICLE_SERVICE_URL,
    VENDOR_SERVICE_URL: source.VENDOR_SERVICE_URL,
    SERVICE_AUTH_TOKEN: source.SERVICE_AUTH_TOKEN,
    CONVERSATION_TTL_SECONDS: source.CONVERSATION_TTL_SECONDS,
    DOWNSTREAM_TIMEOUT_MS: source.DOWNSTREAM_TIMEOUT_MS,
    WHATSAPP_PROCESS_INLINE: source.WHATSAPP_PROCESS_INLINE,
    INBOUND_QUEUE_URL: source.INBOUND_QUEUE_URL,
    WHATSAPP_PILOT_VENDOR_IDS: source.WHATSAPP_PILOT_VENDOR_IDS,
    WHATSAPP_BUSINESS_NAME: source.WHATSAPP_BUSINESS_NAME,
    WHATSAPP_CUSTOMER_LINKS: source.WHATSAPP_CUSTOMER_LINKS,
    DEFAULT_TIMEZONE: source.DEFAULT_TIMEZONE,
    PORT: source.PORT,
  });

  const config: ChannelConfig = {
    stage: parsed.STAGE,
    region: parsed.DEFAULT_AWS_REGION,
    apiVersion: parsed.WHATSAPP_API_VERSION,
    phoneNumberId: parsed.WHATSAPP_PHONE_NUMBER_ID.trim(),
    businessAccountId: parsed.WHATSAPP_BUSINESS_ACCOUNT_ID.trim(),
    verifyToken: parsed.WHATSAPP_VERIFY_TOKEN,
    whatsappSecretName: parsed.WHATSAPP_SECRET_NAME.trim(),
    accessToken: blank(parsed.WHATSAPP_ACCESS_TOKEN),
    appSecret: blank(parsed.WHATSAPP_APP_SECRET),
    conversationTable: parsed.WHATSAPP_CONVERSATION_TABLE,
    catalogServiceUrl: parsed.CATALOG_SERVICE_URL,
    availabilityServiceUrl: parsed.AVAILABILITY_SERVICE_URL,
    pricingServiceUrl: parsed.PRICING_SERVICE_URL,
    bookingServiceUrl: parsed.BOOKING_SERVICE_URL,
    userServiceUrl: parsed.USER_SERVICE_URL,
    vehicleServiceUrl: parsed.VEHICLE_SERVICE_URL,
    vendorServiceUrl: parsed.VENDOR_SERVICE_URL,
    serviceAuthToken: blank(parsed.SERVICE_AUTH_TOKEN),
    conversationTtlSeconds: parsed.CONVERSATION_TTL_SECONDS,
    downstreamTimeoutMs: parsed.DOWNSTREAM_TIMEOUT_MS,
    processInline: parsed.WHATSAPP_PROCESS_INLINE === 'true',
    inboundQueueUrl: parsed.INBOUND_QUEUE_URL,
    pilotVendorIds: parsed.WHATSAPP_PILOT_VENDOR_IDS.split(',').map((id) => id.trim()).filter(Boolean),
    businessName: parsed.WHATSAPP_BUSINESS_NAME,
    customerLinks: parseLinks(parsed.WHATSAPP_CUSTOMER_LINKS),
    timezone: parsed.DEFAULT_TIMEZONE,
    port: parsed.PORT,
  };

  if (source === process.env) cached = config;
  return config;
}

export function resetConfigForTests(): void {
  cached = undefined;
}

export function isTestRuntime(source: NodeJS.ProcessEnv = process.env): boolean {
  return source.NODE_ENV === 'test';
}
