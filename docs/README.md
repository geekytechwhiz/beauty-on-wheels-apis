# API-Hub Documentation

Welcome to the API-Hub documentation. This directory contains all technical documentation organized by category.

## 📚 Documentation Structure

### 🏗️ [Architecture](./architecture/)
System architecture and design documents.
- **[system-architecture.md](./architecture/system-architecture.md)** - Overall system design and patterns

### 📋 [Coding Standards](./coding-standards/)
Coding conventions, patterns, and best practices.
- **[API Response Standards](./coding-standards/api-response/)** - Unified API response patterns
  - Usage guides, naming conventions, examples, and migration guides

### 🎯 [Services](./services/)
Service-specific documentation organized by requirements, prompts, and implementation.

#### Organization Service
- **[Requirements](./services/organization-service/requirements/)** - Database schema and specifications
- **[Implementation](./services/organization-service/implementation/)** - Schema review and implementation details
- **[Prompts](./services/organization-service/prompts/)** - AI/Development prompts

#### Device Service
- **[Migration Document](./services/device-service/DEVICE_MICROSERVICE_MIGRATION_DOCUMENT.md)** - Complete migration blueprint
- **[Prompts](./services/device-service/prompts/)** - AI/Development prompts for production-ready code generation

#### FHIR Gateway
- **[Requirements](./services/fhir-gateway/requirements/)** - Architecture review and mapping configs
- **[Implementation](./services/fhir-gateway/implementation/)** - Implementation checklist
- **[AI Agent](./services/fhir-gateway/ai-agent/)** - AI-powered FHIR mapping agent documentation

### 🏗️ [Infrastructure](./infrastructure/)
Infrastructure configuration and deployment documentation.
- **[CDN](./infrastructure/cdn/)** - CloudFront CDN configuration and message resolver
- **[Unified Response](./infrastructure/unified-response/)** - Unified API response migration

### 🔧 [Troubleshooting](./troubleshooting/)
Problem diagnosis and resolution guides.
- **[Runtime Errors](./troubleshooting/runtime-errors/)** - Module resolution and runtime issues
- **[Production Fixes](./troubleshooting/production-fixes/)** - Production incident documentation

---

## 🚀 Quick Links

### For Developers
- **[API Response Usage](./coding-standards/api-response/API_RESPONSE_USAGE.md)** - How to use unified responses
- **[Message Keys Convention](./coding-standards/api-response/MESSAGE_KEYS_CONVENTION.md)** - Naming standards
- **[CDN Configuration](./infrastructure/cdn/CDN_CONFIGURATION.md)** - Message CDN setup

### For Architects
- **[System Architecture](./architecture/system-architecture.md)** - System design overview
- **[Unified Response Migration](./infrastructure/unified-response/UNIFIED_RESPONSE_MIGRATION_SUMMARY.md)** - Complete migration details
- **[FHIR Architecture](./services/fhir-gateway/requirements/FHIR_ADAPTER_ARCHITECTURE_REVIEW.md)** - FHIR gateway design

### For DevOps
- **[CDN Configuration](./infrastructure/cdn/CDN_CONFIGURATION.md)** - Production CDN setup
- **[Runtime Error Fix](./troubleshooting/runtime-errors/SOLUTION_SUMMARY.md)** - Module resolution issues

### For AI/Prompts
- **[Organization Service Prompt](./services/organization-service/prompts/ORGANIZATION_SERVICE_IMPLEMENTATION_PROMPT.md)**
- **[Device Service Prompt](./services/device-service/prompts/DEVICE_SERVICE_IMPLEMENTATION_PROMPT.md)** - Backend AWS Serverless Architect prompt
- **[FHIR AI Agent Guide](./services/fhir-gateway/ai-agent/FHIR_MAPPING_AI_AGENT_GUIDE.md)**
- **[AI Agent Generation](./services/fhir-gateway/ai-agent/AI_AGENT_GENERATION_PROMPT.md)**

---

## 📖 Documentation by Use Case

### Implementing a New Service
1. Review [System Architecture](./architecture/system-architecture.md)
2. Follow [Coding Standards](./coding-standards/)
3. Use [Organization Service](./services/organization-service/) as reference
4. Implement [Unified API Response](./coding-standards/api-response/API_RESPONSE_USAGE.md)

### Troubleshooting Runtime Errors
1. Check [Runtime Errors](./troubleshooting/runtime-errors/) documentation
2. Review [Solution Summary](./troubleshooting/runtime-errors/SOLUTION_SUMMARY.md)
3. Follow [Quick Fix Guide](./troubleshooting/runtime-errors/QUICK_FIX_IMPLEMENTATION.md)

### Setting Up CDN Messages
1. Read [CDN Configuration](./infrastructure/cdn/CDN_CONFIGURATION.md)
2. Review [Message Resolver Guide](./infrastructure/cdn/MESSAGE_RESOLVER_GUIDE.md)
3. Check [Message Examples](./infrastructure/cdn/cdn-messages-example-en.json)

### Working with FHIR
1. Review [FHIR Architecture](./services/fhir-gateway/requirements/FHIR_ADAPTER_ARCHITECTURE_REVIEW.md)
2. Use [AI Agent Guide](./services/fhir-gateway/ai-agent/FHIR_MAPPING_AI_AGENT_GUIDE.md)
3. Follow [Implementation Checklist](./services/fhir-gateway/implementation/FHIR_ADAPTER_IMPLEMENTATION_CHECKLIST.md)

---

## 🔍 Finding Documentation

### By Service
- **Organization**: `./services/organization-service/`
- **Device**: `./services/device-service/`
- **FHIR Gateway**: `./services/fhir-gateway/`

### By Type
- **Requirements**: `./services/*/requirements/`
- **Implementation**: `./services/*/implementation/`
- **Prompts**: `./services/*/prompts/`

### By Topic
- **API Standards**: `./coding-standards/api-response/`
- **Infrastructure**: `./infrastructure/`
- **Troubleshooting**: `./troubleshooting/`

---

## 📝 Document Types

### Requirements 📋
Specifications, database schemas, and technical requirements.

### Prompts 🤖
AI development prompts and context for code generation.

### Implementation 🛠️
Implementation guides, checklists, and review documents.

### Standards 📐
Coding conventions, patterns, and best practices.

### Troubleshooting 🔧
Problem diagnosis, solutions, and incident reports.

---

## 🆕 Recent Updates

- **2026-01-19**: Reorganized documentation structure
- **2026-01-19**: Added CDN configuration for production
- **2026-01-19**: Completed unified API response migration

---

## 🤝 Contributing

When adding new documentation:
1. Place files in appropriate category
2. Follow the service structure (requirements/prompts/implementation)
3. Update relevant README files
4. Keep naming consistent with existing patterns

---

**Last Updated**: 2026-01-19  
**Maintainer**: Architecture Team  
**Status**: ✅ Organized & Current
