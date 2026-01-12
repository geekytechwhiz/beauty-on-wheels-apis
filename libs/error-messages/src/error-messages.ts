import { createLogger, serializeError } from "@api-hub/logger";
import type {
  CdnErrorDefinition,
  ErrorConfig,
  LanguageCode,
  ErrorMessagesOptions,
} from "./types";

const logger = createLogger({ service: "error-messages", redactPII: true });

/**
 * Default configuration values
 */
const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_LANGUAGE = "en";

/**
 * Supported language codes (ISO 639-1)
 * Add more languages as needed
 */
const SUPPORTED_LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "zh", "ja"];

/**
 * Language cache structure: Map<language, { config, lastLoadedAt }>
 */
type LanguageCache = {
  config: ErrorConfig;
  lastLoadedAt: number;
};

const languageCache = new Map<LanguageCode, LanguageCache>();

/**
 * Normalize language code to supported format
 * Extracts primary language from Accept-Language header format (e.g., "en-US" -> "en")
 * Falls back to default language if invalid
 */
export function normalizeLanguage(language?: string | null): LanguageCode {
  if (!language) {
    return DEFAULT_LANGUAGE;
  }

  // Extract primary language code (e.g., "en-US" -> "en", "fr-CA" -> "fr")
  const primaryLang = language.toLowerCase().split("-")[0].split("_")[0].trim();

  // Validate against supported languages
  if (SUPPORTED_LANGUAGES.includes(primaryLang)) {
    return primaryLang;
  }

  // Fallback to default if not supported
  logger.debug({
    event: "unsupported_language_fallback",
    requested: language,
    normalized: primaryLang,
    fallback: DEFAULT_LANGUAGE,
  });

  return DEFAULT_LANGUAGE;
}

/**
 * Fetch error configuration from CDN for a specific language
 */
async function fetchErrorConfigFromCdn(
  language: LanguageCode,
  options: ErrorMessagesOptions
): Promise<ErrorConfig> {
  const baseURL = options.baseURL || process.env.ERROR_MESSAGES_CDN_URL;
  if (!baseURL) {
    logger.debug({ event: "error_config_cdn_url_not_configured" });
    return {};
  }

  const url = `${baseURL}server-side-messages/${language}/errors.json`;
  const timeoutMs = options.timeoutMs || Number(process.env.ERROR_MESSAGES_CDN_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    logger.debug({
      event: "fetching_error_config_from_cdn",
      url,
      language,
      timeoutMs,
    });

    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    } as RequestInit);

    if (!res.ok) {
      logger.error({
        event: "error_config_fetch_failed",
        status: res.status,
        statusText: res.statusText,
        language,
        url,
      });
      return {};
    }

    const json = (await res.json()) as unknown;
    if (!json || typeof json !== "object") {
      logger.error({
        event: "error_config_invalid_json",
        language,
        url,
      });
      return {};
    }

    // We trust the CDN shape here; runtime guard is soft.
    return json as ErrorConfig;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "name" in e && e.name === "AbortError") {
      logger.error({
        event: "error_config_fetch_timeout",
        language,
        url,
        timeoutMs,
      });
    } else {
      logger.error({
        event: "error_config_fetch_unexpected_error",
        err: serializeError(e),
        language,
        url,
      });
    }
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load error configuration for a specific language with caching
 */
async function loadConfig(
  language: LanguageCode,
  options: ErrorMessagesOptions
): Promise<ErrorConfig> {
  const now = Date.now();
  const ttl = options.cacheTtlMs || Number(process.env.ERROR_MESSAGES_CDN_TTL_MS || DEFAULT_TTL_MS);

  // Check cache for this language
  const cached = languageCache.get(language);
  if (cached && now - cached.lastLoadedAt < ttl) {
    logger.debug({
      event: "error_config_cache_hit",
      language,
      age: now - cached.lastLoadedAt,
    });
    return cached.config;
  }

  // Fetch from CDN
  const config = await fetchErrorConfigFromCdn(language, options);
  
  // Update cache
  languageCache.set(language, {
    config,
    lastLoadedAt: now,
  });

  logger.debug({
    event: "error_config_loaded",
    language,
    errorCount: Object.keys(config).length,
  });

  return config;
}

/**
 * Get error definition for a specific error code and language
 * 
 * @param errorCode - The error code (e.g., "ORDERS.VALIDATION_FAILED")
 * @param language - Language code (ISO 639-1, e.g., "en", "es")
 * @param options - Optional configuration
 * @returns Error definition or undefined if not found
 */
export async function getErrorDefinition(
  errorCode: string,
  language?: LanguageCode | null,
  options?: ErrorMessagesOptions
): Promise<CdnErrorDefinition | undefined> {
  const normalizedLang = normalizeLanguage(language);
  const config = await loadConfig(normalizedLang, options || {});
  return config[errorCode];
}

/**
 * Clear the error configuration cache for a specific language or all languages
 * 
 * @param language - Language code to clear, or undefined to clear all
 */
export function clearErrorCache(language?: LanguageCode): void {
  if (language) {
    languageCache.delete(language);
    logger.debug({ event: "error_cache_cleared", language });
  } else {
    languageCache.clear();
    logger.debug({ event: "error_cache_cleared_all" });
  }
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats(): {
  languages: string[];
  entries: number;
} {
  return {
    languages: Array.from(languageCache.keys()),
    entries: languageCache.size,
  };
}

