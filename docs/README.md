# FHIR Mapper Generator Documentation

This directory contains comprehensive documentation for building an AI-Powered Code Generation Agent that automatically generates FHIR response mappings for microservices.

## Documentation Index

### 🎯 Start Here

1. **[AI_AGENT_SUMMARY.md](./AI_AGENT_SUMMARY.md)** - Executive summary with architecture overview, benefits, and quick reference
   - **Read first** to understand the overall solution and approach

### 📚 Implementation Guides

2. **[FHIR_MAPPING_AI_AGENT_GUIDE.md](./FHIR_MAPPING_AI_AGENT_GUIDE.md)** - Complete implementation guide
   - Detailed step-by-step instructions
   - Architecture diagrams and component design
   - Code examples and templates
   - Technology stack recommendations
   - 6-phase implementation timeline (6 weeks)

3. **[QUICK_START_AI_AGENT.md](./QUICK_START_AI_AGENT.md)** - Quick start guide
   - Implementation checklist
   - Minimal viable implementation approach
   - Key patterns reference
   - Example usage commands

### 🔍 Reference Documentation

4. **[PATTERN_ANALYSIS.md](./PATTERN_ANALYSIS.md)** - Detailed pattern analysis
   - Architecture flow diagrams
   - Handler, Service Client, and Adapter patterns
   - 8 mapping pattern categories with examples
   - Utility function usage
   - Error handling and logging patterns
   - Common transformations

5. **[AI_AGENT_GENERATION_PROMPT.md](./AI_AGENT_GENERATION_PROMPT.md)** - Detailed AI generation prompt
   - **Use this prompt** to instruct an AI (GPT-4, Claude, etc.) to build the agent
   - Complete code templates with exact structure
   - Implementation requirements for each component
   - Phase-by-phase implementation steps
   - Constraints and success criteria

### 📋 Configuration Examples

6. **[mapping-config-example.yaml](./mapping-config-example.yaml)** - Example configuration file
   - Complete YAML configuration example
   - All mapping types demonstrated
   - Custom transformation examples
   - AI configuration options

## Quick Navigation by Role

### For Architects
- Start with: [AI_AGENT_SUMMARY.md](./AI_AGENT_SUMMARY.md)
- Then read: [FHIR_MAPPING_AI_AGENT_GUIDE.md](./FHIR_MAPPING_AI_AGENT_GUIDE.md) (Architecture section)

### For Developers Implementing the Tool
- Start with: [QUICK_START_AI_AGENT.md](./QUICK_START_AI_AGENT.md)
- Reference: [PATTERN_ANALYSIS.md](./PATTERN_ANALYSIS.md) for patterns
- Use: [AI_AGENT_GENERATION_PROMPT.md](./AI_AGENT_GENERATION_PROMPT.md) as your implementation guide

### For AI/LLM to Build the Tool
- **Primary**: [AI_AGENT_GENERATION_PROMPT.md](./AI_AGENT_GENERATION_PROMPT.md)
- **Reference**: [PATTERN_ANALYSIS.md](./PATTERN_ANALYSIS.md) for code patterns
- **Reference**: [mapping-config-example.yaml](./mapping-config-example.yaml) for config structure

### For Configuration Writers
- Primary: [mapping-config-example.yaml](./mapping-config-example.yaml)
- Reference: [PATTERN_ANALYSIS.md](./PATTERN_ANALYSIS.md) (Mapping Pattern Categories section)

## Codebase References

When implementing, reference these existing files:

### Service Client Pattern
- `apps/fhir-gateway/src/services/user-service.client.ts`

### Handler Patterns
- `apps/fhir-gateway/src/handlers/patient.ts` (basic handler)
- `apps/fhir-gateway/src/handlers/practitioner.ts` (similar pattern)
- `apps/fhir-gateway/src/handlers/related-person.ts` (with query parameters)

### Adapter Patterns
- `libs/fhir/src/adapters/identity/patient.adapter.ts` (comprehensive mappings)
- `libs/fhir/src/adapters/identity/practitioner.adapter.ts` (work-specific patterns)
- `libs/fhir/src/adapters/identity/related-person.adapter.ts` (parameterized adapter)

### Utility Functions
- `libs/fhir/src/utils/coding.ts` (CodeableConcept utilities)
- `libs/fhir/src/utils/reference.ts` (Reference utilities)
- `libs/fhir/src/utils/date.ts` (Date utilities)

### FHIR Models
- `libs/fhir/src/models/r4/common.ts` (shared types)
- `libs/fhir/src/models/r4/patient.ts` (resource type example)

### Configuration
- `apps/fhir-gateway/serverless.yml` (Lambda configuration pattern)

## Implementation Timeline

### Recommended Approach

**Week 1-2: Foundation**
- Set up project structure
- Create configuration schema
- Implement pattern analyzer

**Week 3-4: Core Generation**
- Implement code generator
- Create templates
- Add file writer

**Week 5-6: AI Integration & Polish**
- Add AI/LLM integration
- Implement CLI interface
- Testing and refinement

### Alternative: Quick POC (1-2 weeks)
- Start with rule-based generation only (no AI)
- Use simple pattern matching
- Generate one resource type (e.g., Medication)
- Validate approach before full implementation

## Key Patterns Identified

The agent must generate code following these patterns:

1. **Service Clients** - Axios-based HTTP clients with interceptors
2. **Handlers** - Lambda handlers with validation, logging, error handling
3. **Adapters** - Pure transformation functions (DTO → FHIR Resource)
4. **8 Mapping Patterns**:
   - Direct mappings
   - Transformed mappings (gender, dates)
   - CodeableConcept mappings
   - Reference mappings
   - Array mappings
   - Composite mappings
   - Conditional mappings
   - Nested object mappings

## Success Metrics

The generated code should:
- ✅ Compile without TypeScript errors
- ✅ Match existing patterns exactly
- ✅ Pass ESLint rules
- ✅ Follow workspace conventions
- ✅ Include proper error handling
- ✅ Include structured logging
- ✅ Support all common FHIR mapping patterns

## Getting Help

1. **Review existing code** in `apps/fhir-gateway` and `libs/fhir` for patterns
2. **Check pattern analysis** in [PATTERN_ANALYSIS.md](./PATTERN_ANALYSIS.md)
3. **Reference implementation guide** in [FHIR_MAPPING_AI_AGENT_GUIDE.md](./FHIR_MAPPING_AI_AGENT_GUIDE.md)
4. **Use the generation prompt** in [AI_AGENT_GENERATION_PROMPT.md](./AI_AGENT_GENERATION_PROMPT.md)

## Next Steps

1. ✅ Read [AI_AGENT_SUMMARY.md](./AI_AGENT_SUMMARY.md) for overview
2. ✅ Review [QUICK_START_AI_AGENT.md](./QUICK_START_AI_AGENT.md) for quick reference
3. ✅ Study [PATTERN_ANALYSIS.md](./PATTERN_ANALYSIS.md) for code patterns
4. ✅ Use [AI_AGENT_GENERATION_PROMPT.md](./AI_AGENT_GENERATION_PROMPT.md) to build the tool
5. ✅ Reference [mapping-config-example.yaml](./mapping-config-example.yaml) for configuration

---

**Last Updated**: Documentation created for AI-Powered FHIR Mapper Generator
**Status**: Ready for implementation

