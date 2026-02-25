# @api-hub/error-messages

Library for fetching and managing error messages from CDN with multi-language support.

## Features

- Fetches error definitions from CloudFront CDN
- Multi-language support with automatic fallback to English
- In-memory caching for better performance
- Language code normalization

## Usage

```typescript
import { getErrorDefinition, normalizeLanguage } from '@api-hub/error-messages';

// Get an error definition
const errorDef = await getErrorDefinition('USER_NOT_FOUND', 'en');
console.log(errorDef.title, errorDef.description);

// Normalize a language code
const lang = normalizeLanguage('en-US'); // returns 'en'
```

## Configuration

Set the `ERROR_MESSAGES_CDN_URL` environment variable to point to your CDN base URL:

```
ERROR_MESSAGES_CDN_URL=https://your-cdn.cloudfront.net
```

The library will fetch error definitions from:
```
{CDN_URL}/server-side-messages/{language}/errors.json
```
