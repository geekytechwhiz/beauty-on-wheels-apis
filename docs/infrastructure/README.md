# Infrastructure Documentation

Infrastructure configuration, deployment, and operational documentation.

## 📂 Contents

### [CDN](./cdn/)
CloudFront CDN configuration for internationalized messages.

#### 📄 Documents

1. **[CDN_CONFIGURATION.md](./cdn/CDN_CONFIGURATION.md)**
   - Complete CDN setup guide
   - Production URL configuration
   - Language support (English, Spanish, etc.)
   - Testing and troubleshooting
   - **Production URL**: https://d2p9v61861q1ox.cloudfront.net

2. **[MESSAGE_RESOLVER_GUIDE.md](./cdn/MESSAGE_RESOLVER_GUIDE.md)**
   - Message resolution from CDN
   - Language detection and fallback
   - Caching behavior
   - Implementation guide

3. **[cdn-messages-example-en.json](./cdn/cdn-messages-example-en.json)**
   - English message reference
   - 38+ message keys
   - Ready for production merge

4. **[cdn-messages-example-es.json](./cdn/cdn-messages-example-es.json)**
   - Spanish message reference
   - Complete translations
   - Ready for CDN upload

**Status**: ✅ Production Ready  
**CDN**: ✅ Live with 300+ messages  
**Languages**: English (live), Spanish (ready)

---

### [Unified Response](./unified-response/)
Unified API response structure migration and configuration.

#### 📄 Documents

1. **[UNIFIED_RESPONSE_MIGRATION_SUMMARY.md](./unified-response/UNIFIED_RESPONSE_MIGRATION_SUMMARY.md)**
   - Complete migration documentation
   - Technical architecture
   - Files modified
   - Message key catalog
   - Testing procedures
   - **Use this for**: Understanding the entire migration

2. **[CONFIGURATION_COMPLETE.md](./unified-response/CONFIGURATION_COMPLETE.md)**
   - Configuration status
   - Environment setup
   - CDN integration
   - Testing guide
   - **Use this for**: Quick configuration reference

**Status**: ✅ Migration Complete  
**Services Updated**: user-service, organization-service  
**Response Calls**: 53+ updated  
**Message Keys**: 38 created

---

## 🚀 Quick Links

### For DevOps Engineers
- **[CDN Setup](./cdn/CDN_CONFIGURATION.md)** - Production CDN configuration
- **[Configuration Status](./unified-response/CONFIGURATION_COMPLETE.md)** - Current setup

### For Developers
- **[Message Resolver](./cdn/MESSAGE_RESOLVER_GUIDE.md)** - How message resolution works
- **[Migration Summary](./unified-response/UNIFIED_RESPONSE_MIGRATION_SUMMARY.md)** - Full technical details

### For Architects
- **[CDN Architecture](./cdn/CDN_CONFIGURATION.md)** - CDN design and patterns
- **[Unified Response Architecture](./unified-response/UNIFIED_RESPONSE_MIGRATION_SUMMARY.md)** - Response standardization

---

## 📊 Infrastructure Status

### CDN Configuration
- ✅ **Production URL**: https://d2p9v61861q1ox.cloudfront.net
- ✅ **English Messages**: 300+ keys live
- 🔄 **Spanish Messages**: Ready for upload
- ✅ **All Services**: Configured with CDN URL

### Unified Response
- ✅ **Migration**: Complete
- ✅ **Services**: user-service, organization-service
- ✅ **Message Keys**: 38 new keys created
- ✅ **Linter**: Zero errors

---

## 🛠️ Common Tasks

### Testing CDN
```bash
# Check CDN availability
curl https://d2p9v61861q1ox.cloudfront.net/error-messages/en.json | jq

# Test API with language
curl -H "Accept-Language: es" https://your-api.com/health
```

### Adding New Language
```bash
# 1. Create translation file
cp cdn-messages-example-en.json cdn-messages-example-fr.json
# 2. Translate messages
# 3. Upload to CDN
aws s3 cp cdn-messages-example-fr.json s3://bucket/error-messages/fr.json
# 4. Invalidate cache
aws cloudfront create-invalidation --distribution-id ID --paths "/error-messages/fr.json"
```

### Updating Messages
```bash
# 1. Edit local file
vim cdn-messages-example-en.json
# 2. Merge with production
# 3. Upload to CDN
# 4. Invalidate cache
```

---

## 🔗 Related Documentation

### Coding Standards
- [API Response Usage](../coding-standards/api-response/API_RESPONSE_USAGE.md)
- [Message Keys Convention](../coding-standards/api-response/MESSAGE_KEYS_CONVENTION.md)

### Services
- [Organization Service](../services/organization-service/)
- [FHIR Gateway](../services/fhir-gateway/)

---

## 📈 Metrics

### CDN Performance
- **Cache Hit Ratio**: Monitor in CloudWatch
- **Response Time**: ~50-100ms
- **Languages**: 2 configured (EN, ES)
- **Message Keys**: 338+ total

### Migration Impact
- **Code Reduction**: 60% per response call
- **Response Calls Updated**: 53+
- **Services Migrated**: 2
- **Breaking Changes**: 0

---

## 🆕 Upcoming Infrastructure

### Planned Additions
- [ ] Additional language support (French, German)
- [ ] CDN analytics and monitoring
- [ ] Automated message synchronization
- [ ] A/B testing for messages
- [ ] Regional CDN optimization

---

**Last Updated**: 2026-01-19  
**CDN Status**: ✅ Production Ready  
**Migration**: ✅ Complete
