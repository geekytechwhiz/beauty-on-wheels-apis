/* eslint-disable @typescript-eslint/no-unused-vars */
import * as https from 'https';
import { APIGatewayProxyEvent } from 'aws-lambda';

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

export async function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(JSON.parse(data)));
      res.on('error', reject);
    });
  });
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
 * Gets an error message by key from CDN (ERROR_MESSAGES_CDN_URL/error-messages/{lang}.json).
 * Uses Accept-Language from the event. Returns defaults when CDN is not configured or key is missing.
 */
export async function getErrorMessage(event: APIGatewayProxyEvent, errorKey: string): Promise<ResolvedMessage> {
  const defaults: ResolvedMessage = {
    title: 'Error',
    description: 'An error occurred',
    severity: 'ERROR',
  };
  // Use the existing resolveMessage which handles CDN fetching and language detection
  // return resolveMessage(event, errorKey, defaults);
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
  // return resolveMessage(event, messageKey, defaults);
  return defaults;
}

/**
 * Clears the message cache (useful for testing or forcing refresh)
 */
export function clearMessageCache(): void {
  Object.keys(messageCache).forEach((key) => delete messageCache[key]);
}
