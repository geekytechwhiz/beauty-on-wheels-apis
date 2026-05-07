# AI Agent for FHIR Response Mapping Generation

## Executive Summary

This document provides a comprehensive step-by-step guide for creating an AI-powered CLI plugin/extension that automatically generates FHIR response mappings based on API responses from microservices. The agent analyzes existing patterns in `user-service` and `fhir-gateway` to generate consistent, maintainable code for all 25+ microservices.

## Table of Contents

1. [Pattern Analysis](#pattern-analysis)
2. [Agent Architecture](#agent-architecture)
3. [Implementation Steps](#implementation-steps)
4. [Configuration Schema](#configuration-schema)
5. [Code Generation Templates](#code-generation-templates)
6. [Validation & Testing Strategy](#validation--testing-strategy)
7. [CLI Interface Design](#cli-interface-design)

---

## Pattern Analysis

### 1. Service Client Pattern

**Location**: `apps/fhir-gateway/src/services/{service-name}.client.ts`

**Key Characteristics**:
- Axios-based HTTP client with interceptors
- Environment-based configuration (`{SERVICE}_URL`)
- Error handling with custom error classes
- Authorization header forwarding
- Correlation ID support
- Structured logging with PII redaction

**Template Structure**:
```typescript
export class {Service}ServiceClient {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.{SERVICE}_SERVICE_URL || 'http://localhost:3000';
    this.client = this.createClient();
  }

  async get{Resource}(id: string, correlationId?: string, authHeader?: string): Promise<{Resource}> {
    // Request implementation
  }
}

export class {Resource}NotFoundError extends Error {
  // Custom error class
}
```

### 2. FHIR Handler Pattern

**Location**: `apps/fhir-gateway/src/handlers/{resource-name}.ts`

**Key Characteristics**:
- AWS Lambda handler function (`main`)
- Parameter extraction from `event.pathParameters` and `event.queryStringParameters`
- Authentication validation
- Service client invocation
- Adapter function call (`to{Resource}`)
- FHIR-formatted response with proper headers
- Error handling with problem responses
- Structured logging with correlation IDs

**Template Structure**:
```typescript
export async function main(
  event: APIGatewayProxyEvent,
  context?: Context
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const {resourceId} = event.pathParameters?.id;
  const authHeader = getAccessTokenFromHeaders(event.headers || {});

  // Validation
  // Service client call
  // Adapter transformation
  // Response formatting
}
```

### 3. Adapter Pattern

**Location**: `libs/fhir/src/adapters/{category}/{resource}.adapter.ts`

**Key Characteristics**:
- Pure transformation function: `to{Resource}(dto: {DTO}, baseUrl?: string): {Resource}`
- Field mapping with conditional inclusion
- Utility functions for complex types (codes, references, dates)
- Optional parameters handling
- Type-safe transformations

**Mapping Categories**:
1. **Simple Direct Mappings**: `user.firstName → patient.name[0].given[0]`
2. **Transformed Mappings**: `user.gender → mapGender(user.gender) → 'male' | 'female' | 'other' | 'unknown'`
3. **Composite Mappings**: Multiple fields → single FHIR structure (e.g., address)
4. **Array Mappings**: `user.additionalEmailIDs → telecom[]`
5. **Nested Object Mappings**: `user.emergencyContact → contact[]`
6. **CodeableConcept Mappings**: String → CodeableConcept using `createCodeableConcept()`
7. **Reference Mappings**: ID → Reference using `createReference()` or specialized functions

### 4. FHIR Model Pattern

**Location**: `libs/fhir/src/models/r4/{resource}.ts`

**Key Characteristics**:
- TypeScript interfaces extending `Resource`
- FHIR R4 specification compliance
- Optional fields properly typed
- Import from `./common` for shared types

### 5. Utility Functions

**Location**: `libs/fhir/src/utils/`

**Utilities**:
- `coding.ts`: `createCodeableConcept()`, `createCoding()`, `CodingSystems` constants
- `reference.ts`: `createReference()`, `createPatientReference()`, etc.
- `date.ts`: `toFhirDate()`, `toFhirDateTime()`, `getCurrentFhirDateTime()`

---

## Agent Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Agent CLI Plugin                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Config     │  │   Pattern    │  │   Code       │      │
│  │   Parser     │  │   Analyzer   │  │   Generator  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                 │                   │              │
│         └─────────────────┼───────────────────┘              │
│                           │                                  │
│                  ┌────────▼─────────┐                        │
│                  │  Template Engine │                        │
│                  │  (Handlebars/    │                        │
│                  │   Mustache)      │                        │
│                  └────────┬─────────┘                        │
│                           │                                  │
│                  ┌────────▼─────────┐                        │
│                  │  File System     │                        │
│                  │  Operations      │                        │
│                  └──────────────────┘                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌───────▼────────┐  ┌───────▼────────┐
│  Service API   │  │  Existing      │  │  FHIR Spec     │
│  Response      │  │  Code Patterns │  │  Schema        │
│  (JSON Schema) │  │  (Examples)    │  │  (TypeScript)  │
└────────────────┘  └────────────────┘  └────────────────┘
```

### Technology Stack Recommendations

1. **CLI Framework**: 
   - `commander` or `yargs` for command-line interface
   - `inquirer` or `prompts` for interactive prompts

2. **AI/ML Component**:
   - Option A: **LLM Integration** (OpenAI GPT-4, Anthropic Claude, or local LLM)
   - Option B: **Rule-based + Pattern Matching** with AI assistance for edge cases
   - Option C: **Hybrid**: Rule-based for standard mappings, LLM for complex transformations

3. **Code Generation**:
   - `handlebars` or `mustache` for template rendering
   - `prettier` for code formatting
   - `typescript` compiler API for type analysis

4. **Configuration**:
   - `yaml` or `json` for mapping configuration
   - `ajv` for schema validation

5. **File Operations**:
   - `fs-extra` for file system operations
   - `glob` for file pattern matching

---

## Implementation Steps

### Phase 1: Foundation (Week 1-2)

#### Step 1.1: Create Nx Plugin/CLI Tool

```bash
# Create new Nx plugin
nx generate @nx/plugin:plugin fhir-mapper-generator --directory=tools

# Or create standalone CLI tool
mkdir tools/fhir-mapper-generator
cd tools/fhir-mapper-generator
npm init -y
```

**Structure**:
```
tools/fhir-mapper-generator/
├── src/
│   ├── commands/
│   │   ├── generate.ts          # Main generation command
│   │   ├── analyze.ts           # Pattern analysis command
│   │   └── validate.ts          # Validation command
│   ├── core/
│   │   ├── config-parser.ts     # Parse mapping config
│   │   ├── pattern-analyzer.ts  # Analyze existing patterns
│   │   ├── code-generator.ts    # Generate code from templates
│   │   └── file-writer.ts       # Write generated files
│   ├── templates/
│   │   ├── service-client.hbs
│   │   ├── handler.hbs
│   │   ├── adapter.hbs
│   │   ├── model.hbs
│   │   └── serverless-config.hbs
│   ├── ai/
│   │   ├── llm-client.ts        # LLM integration
│   │   ├── field-mapper.ts      # AI-powered field mapping
│   │   └── transformation-generator.ts
│   ├── schemas/
│   │   ├── mapping-config.schema.json
│   │   └── service-config.schema.json
│   └── index.ts
├── package.json
└── README.md
```

#### Step 1.2: Define Configuration Schema

Create `schemas/mapping-config.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "service": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "baseUrl": { "type": "string" },
        "apiEndpoint": { "type": "string" },
        "method": { "type": "string", "enum": ["GET", "POST"] },
        "responseType": { "type": "string" }
      },
      "required": ["name", "apiEndpoint"]
    },
    "fhirResource": {
      "type": "object",
      "properties": {
        "resourceType": { "type": "string" },
        "category": { "type": "string" },
        "path": { "type": "string" }
      },
      "required": ["resourceType"]
    },
    "mappings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "source": { "type": "string" },
          "target": { "type": "string" },
          "transformation": { "type": "string" },
          "optional": { "type": "boolean" },
          "condition": { "type": "string" }
        },
        "required": ["source", "target"]
      }
    },
    "customTransformations": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "code": { "type": "string" }
        }
      }
    }
  },
  "required": ["service", "fhirResource", "mappings"]
}
```

#### Step 1.3: Implement Pattern Analyzer

**Purpose**: Analyze existing adapters to learn mapping patterns

**Implementation** (`core/pattern-analyzer.ts`):

```typescript
import * as ts from 'typescript';
import { readFileSync } from 'fs';
import { glob } from 'glob';

interface MappingPattern {
  sourceField: string;
  targetField: string;
  transformation?: string;
  utilityFunctions: string[];
  conditionalLogic?: string;
}

export class PatternAnalyzer {
  async analyzeExistingAdapters(): Promise<MappingPattern[]> {
    const adapterFiles = await glob('libs/fhir/src/adapters/**/*.adapter.ts');
    const patterns: MappingPattern[] = [];

    for (const file of adapterFiles) {
      const sourceCode = readFileSync(file, 'utf-8');
      const patternsInFile = this.extractPatterns(sourceCode);
      patterns.push(...patternsInFile);
    }

    return patterns;
  }

  private extractPatterns(sourceCode: string): MappingPattern[] {
    // Use TypeScript compiler API or regex to extract:
    // 1. Field assignments (user.field → fhir.field)
    // 2. Utility function calls (createCodeableConcept, toFhirDate, etc.)
    // 3. Conditional logic (if statements, ternary operators)
    // 4. Array transformations (map, forEach)
    
    // This is a simplified example - full implementation would use AST parsing
    const patterns: MappingPattern[] = [];
    
    // Extract patterns using regex or AST traversal
    // ... implementation details
    
    return patterns;
  }

  findSimilarPatterns(fieldName: string, fieldType: string): MappingPattern[] {
    // Find similar mapping patterns from existing adapters
    // Can use semantic similarity or simple string matching
  }
}
```

### Phase 2: AI Integration (Week 2-3)

#### Step 2.1: Implement LLM Client

**Implementation** (`ai/llm-client.ts`):

```typescript
import { OpenAI } from 'openai'; // or Anthropic, etc.

export class LLMClient {
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
  }

  async generateFieldMapping(
    sourceField: string,
    sourceType: string,
    targetFhirField: string,
    targetFhirType: string,
    context: {
      existingPatterns: MappingPattern[];
      fhirResourceType: string;
    }
  ): Promise<{
    transformation: string;
    utilityFunctions: string[];
    explanation: string;
  }> {
    const prompt = this.buildMappingPrompt(
      sourceField,
      sourceType,
      targetFhirField,
      targetFhirType,
      context
    );

    const response = await this.client.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are an expert FHIR R4 mapper. Generate TypeScript code to map internal API responses to FHIR resources. Follow these patterns: ${JSON.stringify(context.existingPatterns, null, 2)}`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3, // Lower temperature for more deterministic code
    });

    return this.parseMappingResponse(response.choices[0].message.content);
  }

  private buildMappingPrompt(...): string {
    return `
Given:
- Source field: ${sourceField} (${sourceType})
- Target FHIR field: ${targetFhirField} (${targetFhirType})
- FHIR Resource: ${context.fhirResourceType}

Generate a TypeScript code snippet that:
1. Maps the source field to the target FHIR field
2. Handles optional/nullable values appropriately
3. Uses existing utility functions when possible
4. Follows the patterns in the existing codebase

Return JSON with:
- transformation: string (TypeScript code)
- utilityFunctions: string[] (list of utility functions used)
- explanation: string (brief explanation)
    `;
  }

  private parseMappingResponse(content: string): {...} {
    // Parse LLM response and extract code
  }
}
```

#### Step 2.2: Implement Field Mapper

**Implementation** (`ai/field-mapper.ts`):

```typescript
import { LLMClient } from './llm-client';
import { PatternAnalyzer } from '../core/pattern-analyzer';

export class FieldMapper {
  constructor(
    private llmClient: LLMClient,
    private patternAnalyzer: PatternAnalyzer
  ) {}

  async generateMapping(
    sourceSchema: JSONSchema,
    targetFhirResource: string
  ): Promise<FieldMapping[]> {
    const existingPatterns = await this.patternAnalyzer.analyzeExistingAdapters();
    const mappings: FieldMapping[] = [];

    for (const sourceField of sourceSchema.properties) {
      // Try to find similar existing pattern first
      const similarPattern = this.patternAnalyzer.findSimilarPatterns(
        sourceField.name,
        sourceField.type
      );

      if (similarPattern.length > 0) {
        // Use existing pattern
        mappings.push(this.adaptPattern(similarPattern[0], sourceField));
      } else {
        // Use AI to generate new mapping
        const fhirField = this.inferFhirField(sourceField.name, targetFhirResource);
        const mapping = await this.llmClient.generateFieldMapping(
          sourceField.name,
          sourceField.type,
          fhirField,
          this.getFhirFieldType(fhirField, targetFhirResource),
          {
            existingPatterns,
            fhirResourceType: targetFhirResource,
          }
        );
        mappings.push(mapping);
      }
    }

    return mappings;
  }

  private inferFhirField(sourceFieldName: string, fhirResource: string): string {
    // Use semantic similarity or predefined mappings
    // e.g., "firstName" → "name[0].given[0]"
    // e.g., "emailAddress" → "telecom[?system='email'].value"
  }
}
```

### Phase 3: Code Generation (Week 3-4)

#### Step 3.1: Create Code Templates

**Template: Service Client** (`templates/service-client.hbs`):

```handlebars
/**
 * {{serviceName}} Service Client
 * Production-ready client for calling internal {{serviceName}} via REST
 * Auto-generated by FHIR Mapper Generator
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import { {{responseType}} } from '@api-hub/fhir';
import { createLogger } from '@api-hub/logger';

const logger = createLogger({ service: 'fhir-gateway', redactPII: true });

export class {{ServiceName}}ServiceClient {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.{{SERVICE_NAME}}_SERVICE_URL || 'http://localhost:3000';
    this.client = this.createClient();
  }

  private createClient(): AxiosInstance {
    // ... (standard client creation code)
  }

  async get{{Resource}}({{parameters}}, correlationId?: string, authHeader?: string): Promise<{{ResponseType}}> {
    // ... (implementation based on API endpoint)
  }
}

export class {{Resource}}NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = '{{Resource}}NotFoundError';
    Object.setPrototypeOf(this, {{Resource}}NotFoundError.prototype);
  }
}
```

**Template: Adapter** (`templates/adapter.hbs`):

```handlebars
/**
 * {{Resource}} Adapter
 * Converts internal {{DTOType}} DTO to FHIR R4 {{Resource}} resource
 * Auto-generated by FHIR Mapper Generator
 */

import { {{Resource}} } from '../../models/r4/{{resource}}';
import { {{DTOType}} } from '../../types/internal';
{{#each utilityImports}}
import { {{this}} } from '../../utils/{{@key}}';
{{/each}}

/**
 * Convert internal {{DTOType}} to FHIR {{Resource}}
 */
export function to{{Resource}}(dto: {{DTOType}}, baseUrl?: string): {{Resource}} {
  const {{resource}}Id = dto.{{idField}};

  {{#each mappings}}
  {{#if isArray}}
  const {{variableName}}: {{type}}[] = [];
  {{#if condition}}
  if ({{condition}}) {
  {{/if}}
    {{transformation}}
  {{#if condition}}
  }
  {{/if}}
  {{else}}
  {{#if condition}}
  if ({{condition}}) {
  {{/if}}
    {{transformation}}
  {{#if condition}}
  }
  {{/if}}
  {{/if}}
  {{/each}}

  const {{resource}}: {{Resource}} = {
    resourceType: '{{Resource}}',
    id: {{resource}}Id,
    {{#each fields}}
    {{#if optional}}...({{variableName}} && { {{name}}: {{variableName}} }),{{else}}{{name}}: {{variableName}},{{/if}}
    {{/each}}
    meta: {
      lastUpdated: getCurrentFhirDateTime(),
      ...(baseUrl && { source: baseUrl }),
    },
  };

  return {{resource}};
}
```

#### Step 3.2: Implement Code Generator

**Implementation** (`core/code-generator.ts`):

```typescript
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';

export class CodeGenerator {
  private templates: Map<string, HandlebarsTemplateDelegate> = new Map();

  constructor(private templateDir: string) {
    this.loadTemplates();
    this.registerHelpers();
  }

  private loadTemplates() {
    const templateFiles = [
      'service-client.hbs',
      'handler.hbs',
      'adapter.hbs',
      'model.hbs',
      'serverless-config.hbs',
    ];

    for (const file of templateFiles) {
      const content = readFileSync(join(this.templateDir, file), 'utf-8');
      this.templates.set(file, Handlebars.compile(content));
    }
  }

  private registerHelpers() {
    // Register custom Handlebars helpers
    Handlebars.registerHelper('camelCase', (str) => {
      return str.charAt(0).toLowerCase() + str.slice(1);
    });

    Handlebars.registerHelper('pascalCase', (str) => {
      return str.charAt(0).toUpperCase() + str.slice(1);
    });

    // ... more helpers
  }

  generateServiceClient(config: ServiceConfig): string {
    const template = this.templates.get('service-client.hbs')!;
    return template(config);
  }

  generateAdapter(config: AdapterConfig): string {
    const template = this.templates.get('adapter.hbs')!;
    return template(config);
  }

  generateHandler(config: HandlerConfig): string {
    const template = this.templates.get('handler.hbs')!;
    return template(config);
  }

  generateModel(config: ModelConfig): string {
    const template = this.templates.get('model.hbs')!;
    return template(config);
  }
}
```

### Phase 4: Integration & File Operations (Week 4-5)

#### Step 4.1: Implement File Writer

**Implementation** (`core/file-writer.ts`):

```typescript
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import prettier from 'prettier';

export class FileWriter {
  async writeFile(
    filePath: string,
    content: string,
    options: { format?: boolean } = {}
  ): Promise<void> {
    // Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Format code if requested
    let formattedContent = content;
    if (options.format !== false) {
      formattedContent = await prettier.format(content, {
        parser: 'typescript',
        singleQuote: true,
        trailingComma: 'es5',
      });
    }

    writeFileSync(filePath, formattedContent, 'utf-8');
  }

  async updateServerlessConfig(
    serverlessPath: string,
    newFunction: ServerlessFunction
  ): Promise<void> {
    // Parse serverless.yml
    // Add new function configuration
    // Write back to file
  }

  async updateIndexExports(
    indexPath: string,
    newExports: string[]
  ): Promise<void> {
    // Parse TypeScript index file
    // Add new export statements
    // Write back to file
  }
}
```

### Phase 5: CLI Interface (Week 5)

#### Step 5.1: Implement CLI Commands

**Implementation** (`commands/generate.ts`):

```typescript
import { Command } from 'commander';
import { FieldMapper } from '../ai/field-mapper';
import { CodeGenerator } from '../core/code-generator';
import { FileWriter } from '../core/file-writer';
import { PatternAnalyzer } from '../core/pattern-analyzer';
import { LLMClient } from '../ai/llm-client';
import { readFileSync } from 'fs';

export function registerGenerateCommand(program: Command) {
  program
    .command('generate')
    .description('Generate FHIR mapping code from configuration')
    .requiredOption('-c, --config <path>', 'Path to mapping configuration file')
    .option('-o, --output <path>', 'Output directory (default: workspace root)')
    .option('--no-format', 'Skip code formatting')
    .option('--dry-run', 'Show what would be generated without writing files')
    .action(async (options) => {
      try {
        // Load configuration
        const config = JSON.parse(readFileSync(options.config, 'utf-8'));

        // Initialize components
        const patternAnalyzer = new PatternAnalyzer();
        const llmClient = new LLMClient();
        const fieldMapper = new FieldMapper(llmClient, patternAnalyzer);
        const codeGenerator = new CodeGenerator('./templates');
        const fileWriter = new FileWriter();

        // Generate mappings
        // console.log('Analyzing existing patterns...');
        const mappings = await fieldMapper.generateMapping(
          config.sourceSchema,
          config.fhirResource.resourceType
        );

        // Generate code
        // console.log('Generating code...');
        const serviceClientCode = codeGenerator.generateServiceClient({
          serviceName: config.service.name,
          // ... other config
        });

        const adapterCode = codeGenerator.generateAdapter({
          resourceType: config.fhirResource.resourceType,
          dtoType: config.responseType,
          mappings,
          // ... other config
        });

        const handlerCode = codeGenerator.generateHandler({
          resourceType: config.fhirResource.resourceType,
          serviceName: config.service.name,
          // ... other config
        });

        // Write files
        if (options.dryRun) {
          // console.log('=== Service Client ===');
          // console.log(serviceClientCode);
          // console.log('\n=== Adapter ===');
          // console.log(adapterCode);
          // console.log('\n=== Handler ===');
          // console.log(handlerCode);
        } else {
          const outputDir = options.output || process.cwd();
          
          await fileWriter.writeFile(
            join(outputDir, `apps/fhir-gateway/src/services/${config.service.name}.client.ts`),
            serviceClientCode
          );

          await fileWriter.writeFile(
            join(outputDir, `libs/fhir/src/adapters/${config.fhirResource.category}/${config.fhirResource.resourceType.toLowerCase()}.adapter.ts`),
            adapterCode
          );

          await fileWriter.writeFile(
            join(outputDir, `apps/fhir-gateway/src/handlers/${config.fhirResource.resourceType.toLowerCase()}.ts`),
            handlerCode
          );

          // Update serverless.yml
          await fileWriter.updateServerlessConfig(
            join(outputDir, 'apps/fhir-gateway/serverless.yml'),
            {
              name: `get${config.fhirResource.resourceType}`,
              handler: `src/handlers/${config.fhirResource.resourceType.toLowerCase()}.main`,
              path: `fhir/${config.fhirResource.resourceType}/{id}`,
            }
          );

          // Update index exports
          await fileWriter.updateIndexExports(
            join(outputDir, 'libs/fhir/src/index.ts'),
            [`export * from './adapters/${config.fhirResource.category}/${config.fhirResource.resourceType.toLowerCase()}.adapter';`]
          );

          // console.log('✅ Code generation completed successfully!');
        }
      } catch (error) {
        console.error('❌ Error generating code:', error);
        process.exit(1);
      }
    });
}
```

#### Step 5.2: Implement Interactive Mode

**Implementation** (`commands/interactive.ts`):

```typescript
import inquirer from 'inquirer';
import { FieldMapper } from '../ai/field-mapper';
// ... other imports

export async function interactiveMode() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'serviceName',
      message: 'What is the service name?',
      validate: (input) => input.length > 0,
    },
    {
      type: 'input',
      name: 'apiEndpoint',
      message: 'What is the API endpoint path?',
    },
    {
      type: 'input',
      name: 'fhirResourceType',
      message: 'What FHIR resource type? (e.g., Patient, Practitioner)',
    },
    {
      type: 'input',
      name: 'responseSample',
      message: 'Paste a sample API response (JSON):',
      validate: (input) => {
        try {
          JSON.parse(input);
          return true;
        } catch {
          return 'Invalid JSON';
        }
      },
    },
    {
      type: 'confirm',
      name: 'useAI',
      message: 'Use AI to generate field mappings?',
      default: true,
    },
  ]);

  // Proceed with generation using answers
}
```

### Phase 6: Validation & Testing (Week 6)

#### Step 6.1: Implement Validation

**Implementation** (`commands/validate.ts`):

```typescript
import Ajv from 'ajv';
import { readFileSync } from 'fs';
import * as ts from 'typescript';

export async function validateGeneratedCode(filePath: string): Promise<ValidationResult> {
  const sourceCode = readFileSync(filePath, 'utf-8');
  const result: ValidationResult = {
    syntaxValid: false,
    typeErrors: [],
    warnings: [],
  };

  // TypeScript compilation check
  const program = ts.createProgram([filePath], {
    strict: true,
    noImplicitAny: true,
  });

  const diagnostics = ts.getPreEmitDiagnostics(program);
  
  for (const diagnostic of diagnostics) {
    if (diagnostic.category === ts.DiagnosticCategory.Error) {
      result.typeErrors.push(diagnostic.messageText.toString());
    } else {
      result.warnings.push(diagnostic.messageText.toString());
    }
  }

  result.syntaxValid = result.typeErrors.length === 0;
  return result;
}
```

---

## Configuration Schema

### Example Configuration File

```yaml
# mapping-config.yaml
service:
  name: "medication-service"
  baseUrl: "${env:MEDICATION_SERVICE_URL}"
  apiEndpoint: "/medications/{id}"
  method: "GET"
  responseType: "MedicationDTO"

fhirResource:
  resourceType: "Medication"
  category: "medication"
  path: "medication"

mappings:
  # Simple direct mapping
  - source: "medicationId"
    target: "id"
  
  # Transformed mapping with utility
  - source: "status"
    target: "status"
    transformation: "mapStatus(dto.status)"
  
  # CodeableConcept mapping
  - source: "code"
    target: "code"
    transformation: "createCodeableConcept('http://www.nlm.nih.gov/research/umls/rxnorm', dto.code, dto.codeDisplay)"
  
  # Array mapping
  - source: "ingredients"
    target: "ingredient"
    transformation: "dto.ingredients.map(ing => ({ item: createReference('Substance', ing.id) }))"
  
  # Conditional mapping
  - source: "form"
    target: "form"
    transformation: "createCodeableConcept('http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm', dto.form)"
    optional: true
    condition: "dto.form"

customTransformations:
  - name: "mapStatus"
    code: |
      function mapStatus(status: string): 'active' | 'inactive' | 'entered-in-error' {
        const normalized = status.toLowerCase();
        if (normalized === 'active' || normalized === 'available') return 'active';
        if (normalized === 'inactive' || normalized === 'discontinued') return 'inactive';
        return 'entered-in-error';
      }
```

---

## Code Generation Templates

### Template Variables

All templates support these common variables:

- `{{serviceName}}` - Service name (e.g., "medication-service")
- `{{ServiceName}}` - PascalCase service name (e.g., "MedicationService")
- `{{SERVICE_NAME}}` - UPPER_SNAKE_CASE (e.g., "MEDICATION_SERVICE")
- `{{resourceType}}` - FHIR resource type (e.g., "Medication")
- `{{resource}}` - lowercase resource (e.g., "medication")
- `{{dtoType}}` - DTO type name (e.g., "MedicationDTO")
- `{{mappings}}` - Array of field mappings
- `{{utilityImports}}` - Object with utility function imports needed

---

## Validation & Testing Strategy

### 1. Syntax Validation
- TypeScript compilation check
- ESLint rules validation
- Prettier formatting check

### 2. Type Safety Validation
- Verify all types are imported correctly
- Check for type errors in generated code
- Validate FHIR resource structure against schema

### 3. Pattern Consistency Validation
- Compare generated code against existing patterns
- Check naming conventions
- Verify error handling patterns

### 4. Integration Testing
- Generate code for a test service
- Verify compilation
- Run unit tests if applicable
- Test API integration

---

## CLI Interface Design

### Command Structure

```bash
# Generate from configuration file
nx fhir-mapper generate -c configs/medication-service.yaml

# Interactive mode
nx fhir-mapper generate --interactive

# Analyze existing patterns
nx fhir-mapper analyze

# Validate generated code
nx fhir-mapper validate apps/fhir-gateway/src/handlers/medication.ts

# List available FHIR resources
nx fhir-mapper list-resources

# Generate configuration template
nx fhir-mapper init medication-service
```

### Options

- `--config, -c <path>`: Path to mapping configuration file
- `--output, -o <path>`: Output directory
- `--dry-run`: Preview without writing files
- `--no-format`: Skip code formatting
- `--interactive, -i`: Interactive mode
- `--ai-model <model>`: Specify AI model to use
- `--no-ai`: Use rule-based mapping only
- `--verbose, -v`: Verbose output

---

## Next Steps & Recommendations

### Immediate Actions

1. **Set up development environment** for the CLI tool
2. **Create proof-of-concept** for one service (e.g., medication-service)
3. **Test AI integration** with sample mappings
4. **Gather feedback** from team on generated code quality

### Future Enhancements

1. **Batch generation**: Generate mappings for multiple services at once
2. **Incremental updates**: Update existing mappings when API changes
3. **Mapping suggestions**: AI suggests mappings based on field names
4. **Test generation**: Auto-generate unit tests for adapters
5. **Documentation generation**: Auto-generate mapping documentation
6. **Version control integration**: Auto-commit generated code with proper messages
7. **CI/CD integration**: Validate mappings in CI pipeline

### Best Practices

1. **Always review generated code** before committing
2. **Use version control** for mapping configurations
3. **Keep configurations in sync** with API changes
4. **Document custom transformations** thoroughly
5. **Test generated code** in staging before production
6. **Monitor AI costs** if using paid LLM services

---

## Conclusion

This guide provides a comprehensive blueprint for creating an AI-powered tool to automate FHIR response mapping generation. The agent learns from existing patterns in `user-service` and `fhir-gateway` to generate consistent, maintainable code for all microservices.

Key success factors:
- **Pattern Learning**: Analyze existing code to understand mapping patterns
- **AI Assistance**: Use LLM for complex mappings that don't follow standard patterns
- **Template-based Generation**: Ensure consistency through templates
- **Validation**: Multiple layers of validation ensure code quality
- **Iterative Improvement**: Start with one service, refine, then scale

For questions or contributions, please refer to the project documentation or contact the architecture team.

