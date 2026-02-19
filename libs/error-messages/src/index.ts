import * as https from 'https';

/**
 * Error definition structure
 */
export interface ErrorDefinition {
  title?: string;
  description?: string;
  severity?: string;
}

/**
 * In-memory cache: language -> error definitions
 */
const errorCache: Record<string, Record<string, ErrorDefinition>> = {};

/**
 * Normalizes a language code to lowercase 2-3 letter format
 * @param language - Raw language code
 * @returns Normalized language code, defaults to 'en' if invalid
 */
export function normalizeLanguage(language: string | undefined): string {
  if (!language) return 'en';
  
  const normalized = language.split('-')[0].split(',')[0].trim().toLowerCase();
  return /^[a-z]{2,3}$/.test(normalized) ? normalized : 'en';
}

/**
 * Fetches error definitions from CloudFront CDN for the given language
 * @param language - Language code (e.g., 'en', 'es', 'fr')
 * @returns Promise with error definitions dictionary
 */
export function fetchErrorDefinitionsFromCDN(language: string): Promise<Record<string, ErrorDefinition>> {
  return new Promise((resolve, reject) => {
    const baseUrl = (process.env.ERROR_MESSAGES_CDN_URL || '').replace(/\/$/, '');
    if (!baseUrl) {
      return reject(new Error('ERROR_MESSAGES_CDN_URL environment variable is not set'));
    }

    const url = `${baseUrl}/server-side-messages/${language}/errors.json`;
    
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to fetch from ${url}: HTTP ${res.statusCode}`));
        }

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
        reject(new Error(`Failed to fetch error definitions from ${url}: ${error}`));
      });
  });
}

/**
 * Gets an error definition by key from CDN
 * @param errorKey - Error key to look up
 * @param language - Language code (defaults to 'en')
 * @returns Promise with error definition or undefined if not found
 */
export async function getErrorDefinition(
  errorKey: string,
  language: string = 'en'
): Promise<ErrorDefinition | undefined> {
  try {
    const normalizedLang = normalizeLanguage(language);

    // Fetch error definitions for the requested language if not cached
    if (!errorCache[normalizedLang]) {
      try {
        errorCache[normalizedLang] = await fetchErrorDefinitionsFromCDN(normalizedLang);
      } catch (error) {
        console.warn(`Failed to fetch error definitions for language '${normalizedLang}', falling back to 'en':`, error);
        
        // Fallback to English if primary language fetch fails
        if (normalizedLang !== 'en' && !errorCache['en']) {
          errorCache['en'] = await fetchErrorDefinitionsFromCDN('en');
        }
        
        return errorCache['en']?.[errorKey];
      }
    }

    return errorCache[normalizedLang]?.[errorKey];
  } catch (error) {
    console.error('Error fetching error definition from CDN:', error);
    return undefined;
  }
}

/**
 * Clears the error cache (useful for testing or forcing refresh)
 */
export function clearErrorCache(): void {
  Object.keys(errorCache).forEach((key) => delete errorCache[key]);
}
