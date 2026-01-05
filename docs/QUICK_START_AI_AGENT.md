# Quick Start: FHIR Mapper Generator AI Agent

## Overview

This guide provides a quick start for implementing the AI-powered FHIR Mapper Generator. The agent automates the creation of FHIR response mappings for 25+ microservices based on patterns learned from `user-service` and `fhir-gateway`.

## Key Patterns Identified

### 1. Architecture Pattern

```
Microservice API → Service Client → Handler → Adapter → FHIR Resource
```

- **Service Client**: `apps/fhir-gateway/src/services/{service}.client.ts`
- **Handler**: `apps/fhir-gateway/src/handlers/{resource}.ts`
- **Adapter**: `libs/fhir/src/adapters/{category}/{resource}.adapter.ts`
- **FHIR Model**: `libs/fhir/src/models/r4/{resource}.ts`

### 2. Common Mapping Patterns

#### Direct Mapping
```typescript
// Source: user.userID
// Target: patient.id
id: user.userID
```

#### Transformed Mapping
```typescript
// Source: user.gender (string)
// Target: patient.gender ('male' | 'female' | 'other' | 'unknown')
gender: mapGender(user.gender)
```

#### CodeableConcept Mapping
```typescript
// Source: user.maritalStatus (string)
// Target: patient.maritalStatus (CodeableConcept)
maritalStatus: createCodeableConcept(
  CodingSystems.MARITAL_STATUS,
  user.maritalStatus.toLowerCase().replace(/\s+/g, '-'),
  user.maritalStatus
)
```

#### Reference Mapping
```typescript
// Source: user.organizationID (string)
// Target: patient.managingOrganization (Reference)
managingOrganization: createOrganizationReference(user.organizationID)
```

#### Array Mapping
```typescript
// Source: user.additionalEmailIDs (string[])
// Target: patient.telecom (ContactPoint[])
telecom: user.additionalEmailIDs.map(email => ({
  system: 'email',
  value: email,
  use: 'temp'
}))
```

#### Composite Object Mapping
```typescript
// Source: user.firstName, user.lastName, user.middleName
// Target: patient.name (HumanName[])
name: [{
  use: 'official',
  given: [user.firstName, user.middleName].filter(Boolean),
  family: user.lastName
}]
```

## Implementation Checklist

### Phase 1: Setup (Days 1-3)

- [ ] Create Nx plugin structure or standalone CLI tool
- [ ] Set up project with TypeScript, ESLint, Prettier
- [ ] Install dependencies: `commander`, `inquirer`, `handlebars`, `prettier`
- [ ] Install AI SDK: `openai` or `@anthropic-ai/sdk` (or choose local LLM)
- [ ] Create directory structure for templates and core modules

### Phase 2: Core Components (Days 4-7)

- [ ] Implement `PatternAnalyzer` to extract patterns from existing adapters
- [ ] Create configuration schema (JSON Schema)
- [ ] Implement `CodeGenerator` with Handlebars templates
- [ ] Create templates for:
  - [ ] Service Client
  - [ ] Handler
  - [ ] Adapter
  - [ ] FHIR Model (optional)
  - [ ] Serverless config update

### Phase 3: AI Integration (Days 8-10)

- [ ] Implement `LLMClient` wrapper
- [ ] Create prompt templates for field mapping
- [ ] Implement `FieldMapper` that:
  - [ ] Tries to match existing patterns first
  - [ ] Falls back to AI for unknown mappings
- [ ] Add caching for repeated mappings

### Phase 4: CLI & File Operations (Days 11-12)

- [ ] Implement CLI commands:
  - [ ] `generate` - Main generation command
  - [ ] `analyze` - Pattern analysis
  - [ ] `validate` - Code validation
- [ ] Implement `FileWriter` with:
  - [ ] Code formatting (Prettier)
  - [ ] TypeScript compilation check
  - [ ] Serverless.yml updates
  - [ ] Index file exports

### Phase 5: Testing & Refinement (Days 13-14)

- [ ] Test with one service (e.g., medication-service)
- [ ] Compare generated code with manual implementation
- [ ] Refine templates based on feedback
- [ ] Add error handling and user-friendly messages
- [ ] Document usage in README

## Example Usage

### 1. Create Configuration File

Create `configs/medication-service.yaml`:

```yaml
service:
  name: "medication-service"
  apiEndpoint: "/medications/{id}"
  
fhirResource:
  resourceType: "Medication"
  category: "medication"

mappings:
  - source: "medicationId"
    target: "id"
  - source: "code"
    target: "code"
    transformation: "createCodeableConcept('http://www.nlm.nih.gov/research/umls/rxnorm', dto.code, dto.codeDisplay)"
```

### 2. Run Generator

```bash
# Using Nx plugin
nx fhir-mapper generate -c configs/medication-service.yaml

# Or standalone CLI
fhir-mapper generate -c configs/medication-service.yaml
```

### 3. Review Generated Code

The tool generates:
- `apps/fhir-gateway/src/services/medication-service.client.ts`
- `apps/fhir-gateway/src/handlers/medication.ts`
- `libs/fhir/src/adapters/medication/medication.adapter.ts`
- Updates `apps/fhir-gateway/serverless.yml`
- Updates `libs/fhir/src/index.ts`

### 4. Test and Refine

1. Compile TypeScript: `nx build fhir-gateway`
2. Run tests if applicable
3. Review generated code for accuracy
4. Adjust configuration if needed
5. Re-generate if necessary

## Minimal Viable Implementation

For a quick proof-of-concept, focus on:

1. **Template-based generation** (skip AI initially)
2. **Rule-based field mapping** (simple string matching)
3. **Basic CLI** (generate command only)
4. **One resource type** (e.g., Medication)

Once validated, add:
- AI integration for complex mappings
- Pattern learning from existing code
- Interactive mode
- Validation and testing

## Key Files Reference

### Existing Code to Learn From

**Service Client Pattern**:
- `apps/fhir-gateway/src/services/user-service.client.ts`

**Handler Pattern**:
- `apps/fhir-gateway/src/handlers/patient.ts`
- `apps/fhir-gateway/src/handlers/practitioner.ts`
- `apps/fhir-gateway/src/handlers/related-person.ts`

**Adapter Patterns**:
- `libs/fhir/src/adapters/identity/patient.adapter.ts`
- `libs/fhir/src/adapters/identity/practitioner.adapter.ts`
- `libs/fhir/src/adapters/identity/related-person.adapter.ts`

**Utility Functions**:
- `libs/fhir/src/utils/coding.ts`
- `libs/fhir/src/utils/reference.ts`
- `libs/fhir/src/utils/date.ts`

**FHIR Models**:
- `libs/fhir/src/models/r4/patient.ts`
- `libs/fhir/src/models/r4/practitioner.ts`
- `libs/fhir/src/models/r4/common.ts`

## Next Steps

1. Read the full guide: `docs/FHIR_MAPPING_AI_AGENT_GUIDE.md`
2. Review example configuration: `docs/mapping-config-example.yaml`
3. Start with Phase 1 implementation
4. Test with one service before scaling

## Support

For questions or issues:
- Review existing code patterns in `user-service` and `fhir-gateway`
- Check FHIR R4 specification for resource structures
- Refer to TypeScript compiler API documentation for code analysis
- Consult AI model documentation for prompt engineering

