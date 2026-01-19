# Documentation Structure

Complete directory structure and organization guide.

## 📁 Directory Tree

```
docs/
├── README.md (main index - START HERE)
│
├── architecture/
│   ├── system-architecture.md
│   └── (future: microservices-patterns.md, data-flow.md)
│
├── coding-standards/
│   ├── README.md
│   └── api-response/
│       ├── API_RESPONSE_USAGE.md
│       ├── MESSAGE_KEYS_CONVENTION.md
│       ├── MESSAGE_KEYS_QUICK_REFERENCE.md
│       └── BEFORE_AFTER_COMPARISON.md
│
├── services/
│   ├── README.md
│   │
│   ├── organization-service/
│   │   ├── requirements/
│   │   │   └── ORGANIZATION_SERVICE_DATABASE_SCHEMA.md
│   │   ├── prompts/
│   │   │   └── ORGANIZATION_SERVICE_IMPLEMENTATION_PROMPT.md
│   │   └── implementation/
│   │       └── ORGANIZATION_SCHEMA_REVIEW_SUMMARY.md
│   │
│   ├── device-service/
│   │   └── requirements/
│   │       └── DeviceService.doc
│   │
│   └── fhir-gateway/
│       ├── requirements/
│       │   ├── FHIR_ADAPTER_ARCHITECTURE_REVIEW.md
│       │   └── mapping-config-example.yaml
│       ├── implementation/
│       │   └── FHIR_ADAPTER_IMPLEMENTATION_CHECKLIST.md
│       └── ai-agent/
│           ├── FHIR_MAPPING_AI_AGENT_GUIDE.md
│           ├── AI_AGENT_GENERATION_PROMPT.md
│           ├── AI_AGENT_SUMMARY.md
│           ├── QUICK_START_AI_AGENT.md
│           └── PATTERN_ANALYSIS.md
│
├── infrastructure/
│   ├── README.md
│   │
│   ├── cdn/
│   │   ├── CDN_CONFIGURATION.md
│   │   ├── MESSAGE_RESOLVER_GUIDE.md
│   │   ├── cdn-messages-example-en.json
│   │   └── cdn-messages-example-es.json
│   │
│   └── unified-response/
│       ├── UNIFIED_RESPONSE_MIGRATION_SUMMARY.md
│       └── CONFIGURATION_COMPLETE.md
│
└── troubleshooting/
    ├── README.md
    │
    ├── runtime-errors/
    │   ├── SOLUTION_SUMMARY.md ⭐ (Start here)
    │   ├── RUNTIME_IMPORT_ERROR_ANALYSIS.md
    │   ├── QUICK_FIX_IMPLEMENTATION.md
    │   └── ENHANCED_CURSOR_PROMPT.md
    │
    └── production-fixes/
        └── PRODUCTION_FIX_NOTIFICATION_ERROR.md
```

---

## 📊 Organization Principles

### By Category
1. **Architecture** - System design and patterns
2. **Coding Standards** - Conventions and best practices
3. **Services** - Service-specific documentation
4. **Infrastructure** - Deployment and configuration
5. **Troubleshooting** - Problem diagnosis and solutions

### By Service
Each service has a consistent structure:
- **requirements/** - What needs to be built
- **prompts/** - AI/development context
- **implementation/** - How it was built

### By Purpose
- **README files** - Navigation and overview
- **Requirements** - Specifications and schemas
- **Prompts** - AI development context
- **Implementation** - Guides and checklists
- **Standards** - Patterns and conventions

---

## 🎯 Finding What You Need

### I Need To...

#### Understand System Architecture
→ `architecture/system-architecture.md`

#### Implement API Responses
→ `coding-standards/api-response/API_RESPONSE_USAGE.md`

#### Work on Organization Service
→ `services/organization-service/`
  - Requirements: `requirements/ORGANIZATION_SERVICE_DATABASE_SCHEMA.md`
  - Implementation: `implementation/ORGANIZATION_SCHEMA_REVIEW_SUMMARY.md`

#### Configure CDN Messages
→ `infrastructure/cdn/CDN_CONFIGURATION.md`

#### Fix Runtime Module Error
→ `troubleshooting/runtime-errors/SOLUTION_SUMMARY.md`

#### Use FHIR AI Agent
→ `services/fhir-gateway/ai-agent/QUICK_START_AI_AGENT.md`

---

## 📖 Document Types & Icons

### 📋 Requirements
Technical specifications, database schemas, API contracts.
- What needs to be built
- Business requirements
- Technical constraints

### 🤖 Prompts
AI development context and instructions.
- Problem statement
- Technical context
- Expected behavior
- Constraints

### 🛠️ Implementation
Implementation guides and checklists.
- How to build features
- Step-by-step guides
- Testing procedures
- Deployment steps

### 📐 Standards
Coding conventions and patterns.
- Best practices
- Naming conventions
- Code examples
- Anti-patterns

### 🔧 Troubleshooting
Problem diagnosis and solutions.
- Common issues
- Root cause analysis
- Solutions
- Prevention

---

## 🗂️ File Naming Conventions

### Uppercase with Underscores
```
COMPONENT_TYPE_DESCRIPTION.md

Examples:
- API_RESPONSE_USAGE.md
- ORGANIZATION_SERVICE_DATABASE_SCHEMA.md
- RUNTIME_IMPORT_ERROR_ANALYSIS.md
```

### Lowercase for Config Files
```
kebab-case.format

Examples:
- cdn-messages-example-en.json
- mapping-config-example.yaml
- system-architecture.md
```

### README Files
```
README.md (always capitalized)
```

---

## 📦 What Was Removed

### Duplicates Consolidated
All related documents about the runtime error were kept together in `troubleshooting/runtime-errors/` with clear hierarchy:
1. **SOLUTION_SUMMARY.md** - Quick overview (⭐ start here)
2. **RUNTIME_IMPORT_ERROR_ANALYSIS.md** - Deep technical analysis
3. **QUICK_FIX_IMPLEMENTATION.md** - Step-by-step guide
4. **ENHANCED_CURSOR_PROMPT.md** - AI context

**Rationale**: Each provides different perspectives (executive, technical, procedural, AI) - all valuable.

### No True Duplicates Found
After review, all documents serve unique purposes:
- CONFIGURATION_COMPLETE.md = Quick status summary
- UNIFIED_RESPONSE_MIGRATION_SUMMARY.md = Comprehensive technical guide

Both kept as they serve different audiences.

---

## 🆕 Adding New Documentation

### For New Service
```bash
mkdir -p docs/services/new-service/{requirements,prompts,implementation}
# Add docs to each subdirectory
# Update docs/services/README.md
```

### For New Standard
```bash
mkdir -p docs/coding-standards/new-standard
# Add standard documents
# Update docs/coding-standards/README.md
```

### For New Infrastructure
```bash
mkdir -p docs/infrastructure/new-component
# Add configuration docs
# Update docs/infrastructure/README.md
```

### For New Troubleshooting
```bash
mkdir -p docs/troubleshooting/new-category
# Add troubleshooting docs
# Update docs/troubleshooting/README.md
```

---

## 📊 Statistics

### Total Documents
- **Main README**: 1
- **Category READMEs**: 4
- **Architecture**: 1 document
- **Coding Standards**: 4 documents
- **Services**: 12 documents (3 services)
- **Infrastructure**: 6 documents
- **Troubleshooting**: 5 documents

**Total**: 33 documents

### Organization
- **Top-level categories**: 5
- **Services documented**: 3
- **README files**: 5
- **Subdirectories**: 13

---

## 🔍 Search Strategies

### By Keyword
```bash
# Find all docs mentioning "API"
grep -r "API" docs/

# Find specific error
grep -r "Cannot find module" docs/
```

### By Service
```bash
# List all organization service docs
ls -R docs/services/organization-service/

# Find FHIR docs
find docs/services/fhir-gateway -type f
```

### By Type
```bash
# All requirements
find docs -path "*/requirements/*"

# All prompts
find docs -path "*/prompts/*"

# All implementations
find docs -path "*/implementation/*"
```

---

## 🎯 Quick Navigation

### Most Important Documents
1. **[Main README](./README.md)** - START HERE
2. **[API Response Usage](./coding-standards/api-response/API_RESPONSE_USAGE.md)** - For developers
3. **[CDN Configuration](./infrastructure/cdn/CDN_CONFIGURATION.md)** - For DevOps
4. **[Runtime Error Fix](./troubleshooting/runtime-errors/SOLUTION_SUMMARY.md)** - For troubleshooting

### By Role

#### Developer
- Coding Standards
- Service Implementation Guides
- Troubleshooting

#### Architect
- Architecture
- Service Requirements
- Infrastructure Design

#### DevOps
- Infrastructure
- Troubleshooting
- Production Fixes

#### AI/Prompt Engineer
- Service Prompts
- AI Agent Documentation
- Implementation Context

---

## ✅ Maintenance Checklist

- [ ] Update main README when adding new categories
- [ ] Update category READMEs when adding new docs
- [ ] Follow naming conventions
- [ ] Keep structure consistent
- [ ] Add documents to appropriate directories
- [ ] Update this structure guide when reorganizing

---

**Last Updated**: 2026-01-19  
**Total Documents**: 33  
**Status**: ✅ Organized & Current
