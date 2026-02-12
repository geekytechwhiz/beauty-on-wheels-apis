import * as https from 'https';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getErrorDefinition, normalizeLanguage } from '@api-hub/error-messages';
import { extractLanguageFromEvent } from './headerUtils';

/**
 * Message structure returned from CDN and used in ApiResponse
 */
export interface ResolvedMessage {
  title: string;
  description: string;
  severity: 'SUCCESS' | 'INFO' | 'WARNING' | 'ERROR';
}

/**
 * Raw message structure from CDN (may have missing or invalid fields)
 */
interface RawMessage {
  title?: string;
  description?: string;
  severity?: string;
}

/**
 * In-memory cache: language -> message dictionary
 */
const messageCache: Record<string, Record<string, RawMessage>> = {};

/**
 * Extracts language code from event headers (Accept-Language, language, etc.)
 * Returns lowercase 2-3 letter language code, defaults to 'en'
 */
export function getLanguageFromHeaders(event: APIGatewayProxyEvent): string {
  const headers = event?.headers || {};
  const languageHeader =
    headers['Accept-Language'] ||
    headers['accept-language'] ||
    headers['language'] ||
    headers['Language'] ||
    'en';

  const language = languageHeader.split('-')[0].split(',')[0].trim().toLowerCase();
  return /^[a-z]{2,3}$/.test(language) ? language : 'en';
}

/**
 * Fetches message JSON from CloudFront CDN for the given language
 */
export function fetchMessagesFromCloudFront(language: string): Promise<Record<string, RawMessage>> {
  return new Promise((resolve, reject) => {
    const baseUrl = (process.env.ERROR_MESSAGES_CDN_URL || '').replace(/\/$/, '');
    if (!baseUrl) {
      return reject(new Error('ERROR_MESSAGES_CDN_URL environment variable is not set'));
    }

    const url = `${baseUrl}/error-messages/${language}.json`;
    
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (error) {
            reject(new Error(`Failed to parse JSON from ${url}: ${error}`));
          }
        });
      })
      .on('error', (error) => {
        reject(new Error(`Failed to fetch messages from ${url}: ${error}`));
      });
  });
}

/**
 * Normalizes severity to one of the allowed values
 */
export function normalizeSeverity(
  severity: string | undefined,
  defaultSeverity: 'SUCCESS' | 'INFO' | 'WARNING' | 'ERROR',
): 'SUCCESS' | 'INFO' | 'WARNING' | 'ERROR' {
  const upper = (severity || defaultSeverity).toString().toUpperCase();
  return (['SUCCESS', 'INFO', 'WARNING', 'ERROR'].includes(upper)
    ? upper
    : defaultSeverity) as 'SUCCESS' | 'INFO' | 'WARNING' | 'ERROR';
}

/**
 * Normalizes a raw message from CDN, filling in defaults for missing fields
 */
export function normalizeMessage(rawMessage: RawMessage | undefined, defaults: ResolvedMessage): ResolvedMessage {
  const base = rawMessage || {};
  const title = typeof base.title === 'string' && base.title.trim() ? base.title : defaults.title;
  const description =
    typeof base.description === 'string' && base.description.trim() ? base.description : defaults.description;
  const severity = normalizeSeverity(base.severity, defaults.severity);

  return { title, description, severity };
}

/**
 * Resolves a message by key from CDN, with language detection and fallback to English
 */
export async function resolveMessage(
  event: APIGatewayProxyEvent,
  key: string,
  defaults: ResolvedMessage,
): Promise<ResolvedMessage> {
  try {
    const language = getLanguageFromHeaders(event);

    // Fetch messages for the requested language if not cached
    if (!messageCache[language]) {
      try {
        messageCache[language] = await fetchMessagesFromCloudFront(language);
      } catch (error) {
        console.warn(`Failed to fetch messages for language '${language}', falling back to 'en':`, error);
        
        // Fallback to English if primary language fetch fails
        if (language !== 'en' && !messageCache['en']) {
          try {
            messageCache['en'] = await fetchMessagesFromCloudFront('en');
          } catch (enError) {
            console.error('Failed to fetch English fallback messages:', enError);
            // Return defaults if even English fetch fails
            return { ...defaults, severity: normalizeSeverity(undefined, defaults.severity) };
          }
        }
        
        const messages = messageCache['en'] || {};
        return normalizeMessage(messages[key], defaults);
      }
    }

    const messages = messageCache[language] || {};
    return normalizeMessage(messages[key], defaults);
  } catch (error) {
    console.error('Error resolving message from CloudFront:', error);
    return { ...defaults, severity: normalizeSeverity(undefined, defaults.severity) };
  }
}

/**
 * Gets an error message by key from @api-hub/error-messages (CDN server-side-messages/{lang}/errors.json).
 * Uses Accept-Language / X-Language from the event. Returns defaults when CDN is not configured or key is missing.
 */
export async function getErrorMessage(event: APIGatewayProxyEvent, errorKey: string): Promise<ResolvedMessage> {
  const defaults: ResolvedMessage = {
    title: 'Error',
    description: 'An error occurred',
    severity: 'ERROR',
  };
  try {
    const language = normalizeLanguage(extractLanguageFromEvent(event));
    const def = await getErrorDefinition(errorKey, language);
    if (def) {
      return {
        title: def.title ?? defaults.title,
        description: def.description ?? defaults.description,
        severity: normalizeSeverity(def.severity, 'ERROR'),
      };
    }
  } catch {
    // CDN not configured or fetch failed
  }
  return defaults;
}

/**
 * Gets a success/info message by key from CDN
 * Default: { title: 'Success', description: 'Request processed successfully', severity: 'SUCCESS' }
 */
export async function getMessage(event: APIGatewayProxyEvent, messageKey: string): Promise<ResolvedMessage> {
  const defaults: ResolvedMessage = {
    title: 'Success',
    description: 'Request processed successfully',
    severity: 'SUCCESS',
  };
  return resolveMessage(event, messageKey, defaults);
}

/**
 * Clears the message cache (useful for testing or forcing refresh)
 */
export function clearMessageCache(): void {
  Object.keys(messageCache).forEach((key) => delete messageCache[key]);
}
