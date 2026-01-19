# CDN Configuration Guide

## Production CDN Setup ✅

The API-Hub is configured to use CloudFront CDN for internationalized error/success messages.

### CDN Details

- **Base URL**: `https://d2p9v61861q1ox.cloudfront.net`
- **Distribution**: CloudFront (AWS)
- **Purpose**: Serve localized message JSON files

### URL Structure

```
Base URL: https://d2p9v61861q1ox.cloudfront.net
│
├── /error-messages/en.json    ✅ Available (English)
├── /error-messages/es.json    🔄 To be added (Spanish)
├── /error-messages/fr.json    🔄 To be added (French)
└── /error-messages/...         🔄 Additional languages
```

### Environment Configuration

All services are configured with the CDN URL:

#### User Service (`apps/user-service/serverless.yml`)
```yaml
environment:
  ERROR_MESSAGES_CDN_URL: https://d2p9v61861q1ox.cloudfront.net
```

#### Organization Service (`apps/organization-service/serverless.yml`)
```yaml
environment:
  ERROR_MESSAGES_CDN_URL: https://d2p9v61861q1ox.cloudfront.net
```

#### Order Service (`apps/order-service/serverless.yml`)
```yaml
environment:
  ERROR_MESSAGES_CDN_URL: https://d2p9v61861q1ox.cloudfront.net/
```

**Note:** The trailing slash is optional - the messageResolver code removes it automatically.

---

## Current CDN Content

### English Messages (en.json)

✅ **Live at**: https://d2p9v61861q1ox.cloudfront.net/error-messages/en.json

The production CDN includes extensive message keys across multiple modules:

#### Available Modules in Production:
- **COMMON** - Generic errors (internal server error, etc.)
- **INITIAL_SETUP** - OTP, authentication, validation
- **INVITE_SERVICE** - User invitations, email/phone validation
- **ORGANIZATION** - Organization management
- **USER** - User operations
- **DEVICE** - Device registration
- **NOTIFICATION** - Push notifications, emails, SMS
- **FILE** - File operations
- **PHARMACY** - Pharmacy operations
- **REPORTS** - Report generation
- **APPOINTMENT** - Appointment scheduling
- **AVAILABILITY** - Doctor availability
- **CHAT** - Chat functionality
- **PAYMENT** - Payment processing

#### Sample Messages:
```json
{
  "COMMON.INTERNAL_SERVER_ERROR": {
    "title": "An internal server error occurred. Please try again later.",
    "description": "We couldn't process your request right now. Please try again in a few minutes.",
    "severity": "error"
  },
  "USER.USER_CREATED_SUCCESSFULLY": {
    "title": "User created successfully",
    "description": "The user account has been created successfully.",
    "severity": "success"
  }
}
```

**Total Messages**: 300+ keys available

---

## Local Development Message Keys

### Reference Files (Not on CDN)

We maintain local reference files for new message keys:

- `docs/cdn-messages-example-en.json` - English reference
- `docs/cdn-messages-example-es.json` - Spanish reference

These files include message keys for:
- **HEALTH.*** - Health check messages
- **USER.*** - User service messages (extended)
- **ORGANIZATION.*** - Organization service messages (extended)
- **ORDER.*** - Order service messages
- **REWARDS.*** - Rewards messages
- **COMMON.*** - Common validation/error messages

### Syncing Local to Production CDN

When new message keys are added to the reference files, they should be merged into the production CDN:

```bash
# 1. Review new keys in reference files
cat docs/cdn-messages-example-en.json

# 2. Download current production file
curl https://d2p9v61861q1ox.cloudfront.net/error-messages/en.json > current-en.json

# 3. Merge new keys (manual or script)
# Combine current-en.json with new keys from cdn-messages-example-en.json

# 4. Upload updated file to S3/CloudFront
aws s3 cp merged-en.json s3://your-cdn-bucket/error-messages/en.json

# 5. Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/error-messages/en.json"
```

---

## Adding Spanish Support

### Step 1: Create Spanish Messages

The reference file `docs/cdn-messages-example-es.json` contains Spanish translations for the new message keys.

### Step 2: Upload to CDN

```bash
# Upload Spanish messages
aws s3 cp docs/cdn-messages-example-es.json s3://your-cdn-bucket/error-messages/es.json
```

### Step 3: Test

```bash
# Test Spanish response
curl -H "Accept-Language: es" https://your-api.com/health
```

Expected response:
```json
{
  "success": true,
  "message": {
    "title": "Éxito",
    "description": "Verificación de salud exitosa",
    "severity": "SUCCESS"
  }
}
```

---

## Adding More Languages

### Supported Language Codes

The resolver uses ISO 639-1 two-letter language codes:

| Code | Language | Status |
|------|----------|--------|
| `en` | English | ✅ Live |
| `es` | Spanish | 🔄 Reference ready |
| `fr` | French | ⬜ Not created |
| `de` | German | ⬜ Not created |
| `pt` | Portuguese | ⬜ Not created |
| `hi` | Hindi | ⬜ Not created |
| `zh` | Chinese | ⬜ Not created |
| `ar` | Arabic | ⬜ Not created |

### Creating a New Language File

1. **Copy English template**:
   ```bash
   cp docs/cdn-messages-example-en.json docs/cdn-messages-example-fr.json
   ```

2. **Translate all messages**:
   - Keep the same keys
   - Translate `title` and `description`
   - Keep `severity` unchanged

3. **Upload to CDN**:
   ```bash
   aws s3 cp docs/cdn-messages-example-fr.json s3://your-cdn-bucket/error-messages/fr.json
   ```

4. **Invalidate cache**:
   ```bash
   aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/error-messages/fr.json"
   ```

---

## How Language Resolution Works

### Request Flow

```
1. Client sends request with Accept-Language header
   ↓
2. messageResolver extracts language (e.g., "es")
   ↓
3. Check in-memory cache for "es"
   ↓
4. If not cached, fetch from CDN:
   https://d2p9v61861q1ox.cloudfront.net/error-messages/es.json
   ↓
5. If language file not found, fallback to "en"
   ↓
6. Cache the messages in memory
   ↓
7. Return localized message to ApiResponse
```

### Language Detection Priority

1. `Accept-Language` header (e.g., `en-US` → `en`)
2. `language` header
3. Default fallback: `en`

### Examples

```http
# English (default)
Accept-Language: en

# Spanish
Accept-Language: es

# French (with region code - extracts 'fr')
Accept-Language: fr-FR

# Multiple preferences (uses first)
Accept-Language: es, en;q=0.9, fr;q=0.8
```

---

## Caching Behavior

### In-Memory Cache

- Messages are cached per language per Lambda container
- Cache persists for the lifetime of the Lambda container
- No TTL - relies on container cold starts for refresh
- Cache key: language code (e.g., `"en"`, `"es"`)

### Cache Invalidation

To force all Lambdas to fetch fresh messages:

1. **Update CDN file**
2. **Invalidate CloudFront cache**
3. **Wait for Lambda cold starts** (or force with deployments)

---

## Monitoring & Troubleshooting

### Check CDN Availability

```bash
# Test English
curl -I https://d2p9v61861q1ox.cloudfront.net/error-messages/en.json

# Expected: HTTP/2 200

# Test Spanish (if uploaded)
curl -I https://d2p9v61861q1ox.cloudfront.net/error-messages/es.json
```

### Test Language Resolution

```bash
# Test with English
curl -H "Accept-Language: en" https://your-api/health

# Test with Spanish
curl -H "Accept-Language: es" https://your-api/health

# Test with unsupported language (should fallback to English)
curl -H "Accept-Language: fr" https://your-api/health
```

### Common Issues

#### 1. 404 Not Found for Language File
**Problem**: Language file doesn't exist on CDN  
**Solution**: Upload the language file or fix the CDN URL

#### 2. Fallback to English Always
**Problem**: Language file exists but not being detected  
**Solution**: Check `Accept-Language` header format

#### 3. Stale Messages
**Problem**: Updated CDN but seeing old messages  
**Solution**: 
- Invalidate CloudFront cache
- Wait for Lambda cold start
- Check in-memory cache

#### 4. Missing Message Key
**Problem**: Message key not found in CDN  
**Solution**: Add the key to CDN JSON file and invalidate cache

---

## Best Practices

### 1. Message Key Management
- ✅ Use namespaced keys: `MODULE.MESSAGE_CODE`
- ✅ Keep keys consistent across languages
- ✅ Document new keys in reference files
- ✅ Sync reference files with production CDN regularly

### 2. Translation Quality
- ✅ Use professional translation services for production
- ✅ Maintain cultural sensitivity
- ✅ Keep technical accuracy
- ✅ Test with native speakers

### 3. CDN Performance
- ✅ Enable CloudFront compression
- ✅ Set appropriate cache headers
- ✅ Monitor cache hit rates
- ✅ Use CloudFront origin shield for global distribution

### 4. Error Handling
- ✅ Always provide English fallback
- ✅ Log CDN fetch failures
- ✅ Use default messages if CDN is unavailable
- ✅ Monitor message resolution errors

---

## Quick Reference

### Production CDN URLs
- **Base**: https://d2p9v61861q1ox.cloudfront.net
- **English**: https://d2p9v61861q1ox.cloudfront.net/error-messages/en.json ✅
- **Spanish**: https://d2p9v61861q1ox.cloudfront.net/error-messages/es.json 🔄

### Environment Variable
```yaml
ERROR_MESSAGES_CDN_URL: https://d2p9v61861q1ox.cloudfront.net
```

### Test Commands
```bash
# Check CDN
curl https://d2p9v61861q1ox.cloudfront.net/error-messages/en.json | jq

# Test API with language
curl -H "Accept-Language: es" https://your-api/health | jq
```

---

**Last Updated**: 2026-01-19  
**CDN Status**: ✅ Production Ready (English)  
**Next Steps**: Add Spanish support, monitor performance
