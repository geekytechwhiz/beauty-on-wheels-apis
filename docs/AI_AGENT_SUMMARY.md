# FHIR Mapper Generator: Executive Summary

## Problem Statement

With 25+ microservices, manually creating FHIR response mappings for each service is:
- **Time-consuming**: Each mapping requires 4-5 files (client, handler, adapter, model, config)
- **Error-prone**: Inconsistent patterns across services
- **Maintenance burden**: API changes require manual updates across multiple files

## Solution: AI-Powered Code Generation Agent

An intelligent CLI tool that:
1. **Learns** from existing patterns in `user-service` and `fhir-gateway`
2. **Generates** consistent, production-ready code for new services
3. **Validates** generated code for type safety and correctness
4. **Maintains** consistency across all 25+ services

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Configuration File                        │
│              (mapping-config.yaml)                           │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    AI Agent CLI Tool                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Pattern   │    │   AI/LLM    │    │    Code     │     │
│  │   Analyzer  │───▶│   Mapper    │───▶│  Generator  │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                   │                   │            │
│         │                   │                   │            │
│         └───────────────────┴───────────────────┘            │
│                             │                                │
│                             ▼                                │
│                   ┌──────────────────┐                       │
│                   │  Template Engine │                       │
│                   │  (Handlebars)    │                       │
│                   └──────────────────┘                       │
│                             │                                │
│                             ▼                                │
│                   ┌──────────────────┐                       │
│                   │   File Writer    │                       │
│                   │  (Prettier, TS)  │                       │
│                   └──────────────────┘                       │
│                                                               │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │        Generated Code Files           │
        ├───────────────────────────────────────┤
        │ • Service Client                      │
        │ • Handler                             │
        │ • Adapter                             │
        │ • Updated serverless.yml              │
        │ • Updated index exports               │
        └───────────────────────────────────────┘
```

## Key Components

### 1. Pattern Analyzer
- Analyzes existing adapters (`patient.adapter.ts`, `practitioner.adapter.ts`, etc.)
- Extracts mapping patterns (direct, transformed, codeable concept, reference, array)
- Builds knowledge base for future mappings

### 2. AI/LLM Mapper
- Uses GPT-4/Claude for complex field mappings
- Learns from existing patterns
- Generates TypeScript code for transformations
- Handles edge cases and custom transformations

### 3. Code Generator
- Template-based generation using Handlebars
- Ensures consistency across all generated files
- Supports all standard mapping patterns

### 4. File Writer
- Formats code with Prettier
- Validates TypeScript compilation
- Updates configuration files (serverless.yml, index.ts)
- Handles file system operations safely

## Generated Code Structure

For each microservice, the agent generates:

```
apps/fhir-gateway/
└── src/
    ├── services/
    │   └── {service-name}.client.ts      ← Service client
    └── handlers/
        └── {resource-name}.ts            ← Lambda handler

libs/fhir/src/
├── adapters/
│   └── {category}/
│       └── {resource}.adapter.ts         ← Transformation logic
└── models/r4/
    └── {resource}.ts                     ← FHIR resource type (if new)

apps/fhir-gateway/
└── serverless.yml                        ← Updated with new routes
```

## Workflow

### Step 1: Analyze Existing Patterns
```bash
nx fhir-mapper analyze
```
- Scans existing adapters
- Builds pattern knowledge base
- Identifies common transformations

### Step 2: Create Configuration
Create `configs/{service-name}.yaml` with:
- Service API details
- FHIR resource type
- Field mappings (or let AI infer)

### Step 3: Generate Code
```bash
nx fhir-mapper generate -c configs/medication-service.yaml
```
- Generates all required files
- Updates serverless.yml
- Formats and validates code

### Step 4: Review & Test
- Review generated code
- Run TypeScript compilation
- Test API integration
- Adjust configuration if needed

## Benefits

### Time Savings
- **Before**: 4-8 hours per service (manual implementation)
- **After**: 15-30 minutes per service (generation + review)
- **ROI**: 80-90% time reduction

### Consistency
- All services follow same patterns
- Standardized error handling
- Consistent logging and validation
- Uniform code structure

### Quality
- Type-safe generated code
- Follows existing conventions
- Includes proper error handling
- Validated against TypeScript compiler

### Maintainability
- Easy to update when patterns change
- Configuration-driven approach
- Version-controlled mapping configs
- Automated validation

## Technology Stack

- **CLI Framework**: Commander.js or Yargs
- **Templates**: Handlebars
- **AI/LLM**: OpenAI GPT-4 or Anthropic Claude
- **Code Analysis**: TypeScript Compiler API
- **Formatting**: Prettier
- **Validation**: Ajv (JSON Schema), TypeScript compiler

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- Project setup
- Basic CLI structure
- Configuration schema
- Template creation

### Phase 2: AI Integration (Week 2-3)
- LLM client integration
- Pattern analyzer
- Field mapper implementation

### Phase 3: Code Generation (Week 3-4)
- Template engine
- Code generator
- File writer

### Phase 4: CLI & Integration (Week 4-5)
- CLI commands
- File system operations
- Serverless.yml updates

### Phase 5: Testing & Refinement (Week 5-6)
- Validation
- Testing with real services
- Refinement and optimization

## Success Criteria

✅ **Generates** production-ready code matching existing patterns  
✅ **Validates** all generated code compiles without errors  
✅ **Maintains** consistency across all 25+ services  
✅ **Reduces** mapping creation time by 80%+  
✅ **Supports** all common FHIR mapping patterns  
✅ **Extensible** for custom transformations  

## Next Steps

1. ✅ Review this summary
2. ✅ Read detailed guide: `FHIR_MAPPING_AI_AGENT_GUIDE.md`
3. ✅ Review example config: `mapping-config-example.yaml`
4. ✅ Start Phase 1 implementation
5. ✅ Test with one service (proof of concept)
6. ✅ Iterate and refine
7. ✅ Scale to all 25+ services

## Questions?

- See `FHIR_MAPPING_AI_AGENT_GUIDE.md` for detailed implementation steps
- See `QUICK_START_AI_AGENT.md` for quick reference
- Review existing code in `user-service` and `fhir-gateway` for patterns

