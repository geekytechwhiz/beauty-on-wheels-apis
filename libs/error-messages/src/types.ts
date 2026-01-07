/**
 * Error definition structure from CDN
 */
export type CdnErrorDefinition = {
  title: string;
  description: string;
  severity: string;
};

/**
 * Error configuration cache structure
 */
export type ErrorConfig = Record<string, CdnErrorDefinition>;

/**
 * Language code (ISO 639-1 format, e.g., 'en', 'es', 'fr')
 */
export type LanguageCode = string;

/**
 * Options for error message service
 */
export type ErrorMessagesOptions = {
  /**
   * Base URL for CDN where error messages are hosted
   */
  baseURL?: string;
  /**
   * Timeout in milliseconds for CDN requests
   * @default 1500
   */
  timeoutMs?: number;
  /**
   * Cache TTL in milliseconds
   * @default 300000 (5 minutes)
   */
  cacheTtlMs?: number;
  /**
   * Default language code if not provided
   * @default 'en'
   */
  defaultLanguage?: LanguageCode;
};

