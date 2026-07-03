# Services Documentation

Service-specific documentation organized by requirements, prompts, and implementation guides.

## 📂 Service Structure

Each service follows a consistent documentation structure:

```
service-name/
├── requirements/     - Specifications, schemas, architecture
├── prompts/         - AI/development prompts and context
└── implementation/  - Implementation guides and checklists
```

---

## 🎯 Services

### [Organization Service](./organization-service/)
Organization and hospital management service.

**Requirements**:
- [Database Schema](./organization-service/requirements/ORGANIZATION_SERVICE_DATABASE_SCHEMA.md) - Complete data model

**Prompts**:
- [Implementation Prompt](./organization-service/prompts/ORGANIZATION_SERVICE_IMPLEMENTATION_PROMPT.md) - AI development context

**Implementation**:
- [Schema Review](./organization-service/implementation/ORGANIZATION_SCHEMA_REVIEW_SUMMARY.md) - Review and analysis

**Purpose**: Manage organizations, hospitals, and their relationships  
**Status**: ✅ Implemented

---

### [Device Service](./device-service/)
IoT device registration and management service.

**Requirements**:
- [Migration Document](./device-service/DEVICE_MICROSERVICE_MIGRATION_DOCUMENT.md) - Complete migration blueprint with schemas, endpoints, and architecture

**Prompts**:
- [Implementation Prompt](./device-service/prompts/DEVICE_SERVICE_IMPLEMENTATION_PROMPT.md) - Production-ready code generation prompt for Backend AWS Serverless Architect

**Purpose**: Handle device registration, authentication, and management  
**Status**: 🔄 In Development

---

### [FHIR Gateway](./fhir-gateway/)
FHIR resource transformation and routing gateway with AI-powered mapping.

#### Requirements
- [Architecture Review](./fhir-gateway/requirements/FHIR_ADAPTER_ARCHITECTURE_REVIEW.md) - System architecture
- [Mapping Config Example](./fhir-gateway/requirements/mapping-config-example.yaml) - Configuration template

#### Implementation
- [Implementation Checklist](./fhir-gateway/implementation/FHIR_ADAPTER_IMPLEMENTATION_CHECKLIST.md) - Step-by-step guide

#### AI Agent
- [AI Agent Guide](./fhir-gateway/ai-agent/FHIR_MAPPING_AI_AGENT_GUIDE.md) - Complete AI agent documentation
- [Generation Prompt](./fhir-gateway/ai-agent/AI_AGENT_GENERATION_PROMPT.md) - Prompt engineering
- [Agent Summary](./fhir-gateway/ai-agent/AI_AGENT_SUMMARY.md) - Overview and capabilities
- [Quick Start](./fhir-gateway/ai-agent/QUICK_START_AI_AGENT.md) - Getting started guide
- [Pattern Analysis](./fhir-gateway/ai-agent/PATTERN_ANALYSIS.md) - Mapping pattern insights

**Purpose**: Transform between FHIR resources and internal data models  
**Status**: ✅ Implemented with AI Agent

---

## 📖 How to Use

### When Starting a New Service
1. Create service directory structure:
   ```
   service-name/
   ├── requirements/
   ├── prompts/
   └── implementation/
   ```
2. Add requirements documentation
3. Create AI/development prompts
4. Document implementation as you build

### When Implementing Features
1. Review **requirements/** for specifications
2. Use **prompts/** for AI-assisted development
3. Follow **implementation/** guides and checklists
4. Update docs as features evolve

### When Reviewing Code
1. Verify against **requirements/** specs
2. Check implementation follows **implementation/** guidelines
3. Ensure patterns are consistent across services

---

## 🎯 Common Patterns

### All Services Should
- ✅ Use unified API response structure
- ✅ Implement message key resolution from CDN
- ✅ Follow naming conventions
- ✅ Include health check endpoints
- ✅ Implement proper error handling
- ✅ Use structured logging
- ✅ Support correlation IDs

### Documentation Should Include
- **Requirements**: What needs to be built
- **Prompts**: Context for AI/developers
- **Implementation**: How it was built
- **Examples**: Real code samples
- **Testing**: How to verify

---

## 🔗 Related Documentation

### Coding Standards
- [API Response Usage](../coding-standards/api-response/API_RESPONSE_USAGE.md)
- [Message Keys Convention](../coding-standards/api-response/MESSAGE_KEYS_CONVENTION.md)

### Infrastructure
- [CDN Configuration](../infrastructure/cdn/CDN_CONFIGURATION.md)
- [Unified Response](../infrastructure/unified-response/)

### Troubleshooting
- [Runtime Errors](../troubleshooting/runtime-errors/)
- [Production Fixes](../troubleshooting/production-fixes/)

---

## 📊 Service Status

| Service | Requirements | Implementation | Status |
|---------|--------------|----------------|--------|
| Organization | ✅ Complete | ✅ Complete | 🟢 Production |
| Device | ✅ Complete | 🔄 In Progress (see [alignment plan](./device-service/implementation/SERVERLESS_INFRA_ALIGNMENT_PLAN.md)) | 🟡 Development |
| FHIR Gateway | ✅ Complete | ✅ Complete | 🟢 Production |
| User | 📝 Legacy Docs | ✅ Complete | 🟢 Production |
| Order | 📝 Legacy Docs | ✅ Complete | 🟢 Production |

---

## 🆕 Adding New Services

1. **Create Directory Structure**
   ```bash
   mkdir -p docs/services/new-service/{requirements,prompts,implementation}
   ```

2. **Add Requirements**
   - Database schema
   - API specifications
   - Architecture design
   - Dependencies

3. **Create Prompts**
   - AI development context
   - Technical constraints
   - Expected behavior

4. **Document Implementation**
   - Implementation guide
   - Checklists
   - Testing procedures
   - Deployment steps

5. **Update This README**
   - Add service to the list
   - Link to documentation
   - Update status table

---

**Last Updated**: 2026-07-01  
**Services**: 5 (3 Production, 1 Development, 1 Legacy)  
**Status**: ✅ Organized
