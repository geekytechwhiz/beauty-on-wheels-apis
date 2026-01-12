import { createLogger, serializeError } from "@api-hub/logger";

const logger = createLogger({ service: "error-messages", redactPII: true });

export type CdnErrorDefinition = {
  title: string;
  description: string;
  severity: string;
};

type ErrorConfig = Record<string, CdnErrorDefinition>;

let cachedConfig: ErrorConfig | null = null;
let lastLoadedAt: number | null = null;

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchErrorConfigFromCdn(): Promise<ErrorConfig> {
  const baseURL = process.env.ERROR_MESSAGES_CDN_URL;
  if (!baseURL) {
    logger.debug({ event: "error_config_cdn_url_not_configured" });
    return {};
  }
 
  const url = `${baseURL}server-side-messages/en/errors.json`;
  const timeoutMs = Number(process.env.ERROR_MESSAGES_CDN_TIMEOUT_MS || 1500);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    logger.debug({ event: "fetching_error_config_from_cdn", url, timeoutMs });
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    } as RequestInit);

    if (!res.ok) {
      logger.error({ 
        event: "error_config_fetch_failed", 
        status: res.status,
        statusText: res.statusText,
      });
      return {};
    }

    const json = (await res.json()) as unknown;
    if (!json || typeof json !== "object") {
      logger.error({ event: "error_config_invalid_json" });
      return {};
    }

    // We trust the CDN shape here; runtime guard is soft.
    return json as ErrorConfig;
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'name' in e && e.name === "AbortError") {
      logger.error({ event: "error_config_fetch_timeout" });
    } else {
      logger.error({ 
        event: "error_config_fetch_unexpected_error", 
        err: serializeError(e),
      });
    }
    return {};
  } finally {
    clearTimeout(timer);
  }
}

async function loadConfig(): Promise<ErrorConfig> {
  const now = Date.now();
  const ttl = Number(process.env.ERROR_MESSAGES_CDN_TTL_MS || DEFAULT_TTL_MS);

  if (cachedConfig && lastLoadedAt && now - lastLoadedAt < ttl) {
    return cachedConfig;
  }

  const config = await fetchErrorConfigFromCdn();
  cachedConfig = config;
  lastLoadedAt = now;
  return config;
}

export async function getErrorDefinition(
  errorCode: string
): Promise<CdnErrorDefinition | undefined> {
  const config = await loadConfig();
  return config[errorCode];
}

