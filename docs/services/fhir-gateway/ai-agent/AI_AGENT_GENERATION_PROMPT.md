 

## Context & Objective

You are an expert AI architect and full-stack TypeScript developer tasked with building an **AI-Powered CLI Tool/Plugin** that automatically generates FHIR response mapping code for microservices in an Nx monorepo.

The tool should analyze existing patterns from `user-service` and `fhir-gateway` applications and generate production-ready code (Service Clients, Handlers, Adapters) that follows the exact same patterns, conventions, and architecture.

## Reference Documentation

**MUST REVIEW** these documentation files in the `docs/` directory:
- `FHIR_MAPPING_AI_AGENT_GUIDE.md` - Complete implementation guide with architecture, code examples, and step-by-step instructions
- `PATTERN_ANALYSIS.md` - Detailed analysis of existing code patterns, mapping categories, and code structure
- `QUICK_START_AI_AGENT.md` - Quick reference guide with implementation checklist
- `AI_AGENT_SUMMARY.md` - Executive summary with architecture overview
- `mapping-config-example.yaml` - Example configuration file structure

**MUST ANALYZE** these code files for patterns:
- `apps/fhir-gateway/src/services/user-service.client.ts` - Service client pattern
- `apps/fhir-gateway/src/handlers/patient.ts` - Handler pattern
- `apps/fhir-gateway/src/handlers/practitioner.ts` - Handler pattern (variant)
- `apps/fhir-gateway/src/handlers/related-person.ts` - Handler pattern (with query params)
- `libs/fhir/src/adapters/identity/patient.adapter.ts` - Adapter pattern
- `libs/fhir/src/adapters/identity/practitioner.adapter.ts` - Adapter pattern (variant)
- `libs/fhir/src/adapters/identity/related-person.adapter.ts` - Adapter pattern (with params)
- `libs/fhir/src/utils/coding.ts` - Utility functions
- `libs/fhir/src/utils/reference.ts` - Reference utilities
- `libs/fhir/src/utils/date.ts` - Date utilities
- `libs/fhir/src/models/r4/common.ts` - Common FHIR types
- `apps/fhir-gateway/serverless.yml` - Serverless configuration pattern

## Project Structure Requirements

### Tool Location Options

**Option 1: Nx Plugin** (Recommended for Nx workspace integration)
```
tools/fhir-mapper-generator/
├── src/
│   ├── index.ts
│   ├── executors/
│   │   └── generate/
│   │       └── executor.ts
│   └── generators/
│       └── fhir-mapping/
│           ├── schema.json
│           └── generator.ts
├── project.json
├── package.json
└── tsconfig.json
```

**Option 2: Standalone CLI Tool** (Recommended for broader usage)
```
tools/fhir-mapper-generator/
├── src/
│   ├── index.ts                    # CLI entry point
│   ├── commands/
│   │   ├── generate.ts
│   │   ├── analyze.ts
│   │   ├── validate.ts
│   │   └── init.ts
│   ├── core/
│   │   ├── config-parser.ts
│   │   ├── pattern-analyzer.ts
│   │   ├── code-generator.ts
│   │   └── file-writer.ts
│   ├── ai/
│   │   ├── llm-client.ts
│   │   ├── field-mapper.ts
│   │   └── transformation-generator.ts
│   ├── templates/
│   │   ├── service-client.hbs
│   │   ├── handler.hbs
│   │   ├── adapter.hbs
│   │   ├── model.hbs
│   │   └── serverless-config.hbs
│   └── schemas/
│       ├── mapping-config.schema.json
│       └── service-config.schema.json
├── package.json
├── tsconfig.json
└── README.md
```

## Core Requirements

### 1. Pattern Analysis Engine

**Implementation Requirements:**

```typescript
// src/core/pattern-analyzer.ts
export class PatternAnalyzer {
  /**
   * Analyze existing adapters in libs/fhir/src/adapters/**/*.adapter.ts
   * Extract:
   * - Field mapping patterns (source → target)
   * - Transformation functions used
   * - Utility function usage patterns
   * - Conditional logic patterns
   * - Array transformation patterns
   * - Reference creation patterns
   */
  async analyzeExistingAdapters(): Promise<MappingPattern[]>

  /**
   * Find similar patterns for a given field
   * Use semantic similarity or string matching
   */
  findSimilarPatterns(
    fieldName: string, 
    fieldType: string, 
    targetFhirField: string
  ): MappingPattern[]

  /**
   * Extract patterns from TypeScript source code using AST
   */
  private extractPatternsFromSource(sourceCode: string): MappingPattern[]
}
```

**Pattern Categories to Extract:**
1. Direct mappings: `dto.field → resource.field`
2. Transformed mappings: `mapGender(dto.gender)`
3. CodeableConcept mappings: `createCodeableConcept(system, code, display)`
4. Reference mappings: `createReference(type, id, display)`
5. Array mappings: `dto.array.map(item => transform(item))`
6. Composite mappings: Multiple fields → single structure
7. Conditional mappings: `...(condition && { field: value })`
8. Date transformations: `toFhirDate(dto.date)`

**Reference Implementation Examples:**
- See `libs/fhir/src/adapters/identity/patient.adapter.ts` lines 16-187 for comprehensive mapping patterns
- See `libs/fhir/src/adapters/identity/practitioner.adapter.ts` for work-specific patterns
- See `libs/fhir/src/adapters/identity/related-person.adapter.ts` for parameterized patterns

### 2. AI/LLM Integration

**Implementation Requirements:**

```typescript
// src/ai/llm-client.ts
export class LLMClient {
  /**
   * Generate field mapping transformation code
   * Input: Source field, target FHIR field, context
   * Output: TypeScript transformation code
   */
  async generateFieldMapping(
    sourceField: string,
    sourceType: string,
    targetFhirField: string,
    targetFhirType: string,
    context: {
      existingPatterns: MappingPattern[];
      fhirResourceType: string;
      similarExamples?: string[];
    }
  ): Promise<{
    transformation: string;        // TypeScript code
    utilityFunctions: string[];    // Required imports
    explanation: string;
    confidence: number;
  }>
}
```

**Prompt Template Structure:**
```
System: You are an expert FHIR R4 mapper and TypeScript developer. 
Generate TypeScript code to map internal API responses to FHIR resources.

Context:
- Existing patterns: [JSON array of similar patterns]
- FHIR Resource Type: {resourceType}
- Similar examples from codebase: [code snippets]

User Request:
Source field: {sourceField} (type: {sourceType})
Target FHIR field: {targetFhirField} (type: {targetFhirType})

Requirements:
1. Follow exact patterns from existing codebase
2. Use utility functions when possible (createCodeableConcept, toFhirDate, createReference)
3. Handle optional/nullable values with conditional spread operator
4. Return valid TypeScript code that matches existing adapter style
5. Include proper type safety

Return JSON:
{
  "transformation": "TypeScript code snippet",
  "utilityFunctions": ["function1", "function2"],
  "explanation": "Brief explanation",
  "confidence": 0.95
}
```

**AI Model Configuration:**
- Primary: GPT-4 or Claude 3 Opus (for best code quality)
- Fallback: GPT-3.5-turbo (for cost efficiency)
- Temperature: 0.3 (lower for more deterministic code)
- Max tokens: 2000

### 3. Code Generation Engine

**Template-Based Generation with Handlebars**

**Template: Service Client** (`templates/service-client.hbs`)

**MUST MATCH** the exact structure from `apps/fhir-gateway/src/services/user-service.client.ts`:

```handlebars
/**
 * {{serviceName}} Service Client
 * Production-ready client for calling internal {{serviceName}} via REST
{{#if autoGenerated}}
 * Auto-generated by FHIR Mapper Generator
{{/if}}
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import { {{responseType}} } from '@api-hub/fhir';
import { createLogger } from '@api-hub/logger';

const logger = createLogger({ service: 'fhir-gateway', redactPII: true });

export class {{ServiceName}}ServiceClient {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.{{SERVICE_NAME}}_SERVICE_URL || 'http://localhost:{{defaultPort}}';
    this.client = this.createClient();
  }

  /**
   * Create configured axios instance
   */
  private createClient(): AxiosInstance {
    const client = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
      validateStatus: (status) => status < 500,
    });

    client.interceptors.request.use(
      (config) => {
        if (config.headers) {
          const authHeader = config.headers.Authorization || config.headers.authorization;
          if (authHeader) {
            const authValue = String(authHeader).trim();
            config.headers.Authorization = authValue;
            delete config.headers.authorization;
          }
        }
        return config;
      },
      (error) => {
        logger.error({
          event: '{{serviceName}}_service_request_error',
          err: {
            message: error.message,
            config: {
              url: error.config?.url,
              method: error.config?.method,
            },
          },
        });
        return Promise.reject(error);
      }
    );

    client.interceptors.response.use(
      (response) => {
        return response;
      },
      (error: AxiosError) => {
        if (error.response) {
          logger.warn({
            event: '{{serviceName}}_service_response_error',
            status: error.response.status,
            statusText: error.response.statusText,
            url: error.config?.url,
          });
        } else if (error.request) {
          logger.error({
            event: '{{serviceName}}_service_no_response',
            message: 'No response received from {{serviceName}}',
            url: error.config?.url,
          });
        }
        return Promise.reject(error);
      }
    );

    return client;
  }

  /**
   * Get {{resourceName}} by ID
   */
  async get{{Resource}}({{parameters}}, correlationId?: string, authHeader?: string): Promise<{{ResponseType}}> {
    if (!authHeader) {
      throw new Error('Access token is required');
    }

    if (!{{idParameter}}) {
      throw new Error('{{Resource}} ID is required');
    }

    let token = authHeader.trim();
    
    if (token.startsWith('Bearer ')) {
      token = token.substring(7).trim();
    }
    
    if (!token) {
      throw new Error('Access token cannot be empty');
    }

    const authorizationHeaderValue = `Bearer ${token}`.trim();
    const fullUrl = `${this.baseUrl.replace(/\/$/, '')}{{apiEndpoint}}`;

    try {
      const requestHeaders: Record<string, string> = {
        Authorization: authorizationHeaderValue,
      };

      if (correlationId) {
        requestHeaders['X-Correlation-Id'] = correlationId;
      }

      const response = await this.client.get<{ data: {{ResponseType}} }>(fullUrl, {
        {{#if queryParams}}
        params: {
          {{#each queryParams}}
          {{name}}: {{variableName}},
          {{/each}}
        },
        {{/if}}
        headers: requestHeaders,
      });

      if (response.status === 200 && response.data?.data) {
        return response.data.data;
      }

      if (response.status === 404) {
        throw new {{Resource}}NotFoundError(`{{Resource}} {{idParameter}} not found`);
      }

      throw new Error(
        `Invalid response from {{serviceName}}: status ${response.status}, data: ${JSON.stringify(response.data)}`
      );
    } catch (error) {
      if (error instanceof {{Resource}}NotFoundError) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ title?: string; detail?: string; status?: number }>;
        
        if (axiosError.response?.status === 401) {
          throw new Error('Unauthorized: Invalid or expired access token');
        }

        if (axiosError.response?.status === 403) {
          throw new Error('Forbidden: Insufficient permissions');
        }

        if (axiosError.response?.status === 404) {
          throw new {{Resource}}NotFoundError(`{{Resource}} {{idParameter}} not found`);
        }

        if (axiosError.response?.status === 429) {
          throw new Error('Rate limit exceeded: Too many requests');
        }

        logger.error({
          event: '{{serviceName}}_service_client_error',
          err: {
            message: axiosError.message,
            status: axiosError.response?.status,
            statusText: axiosError.response?.statusText,
            data: axiosError.response?.data,
            url: axiosError.config?.url,
          },
          {{idParameter}},
          correlationId,
        });

        const errorData = axiosError.response?.data as { detail?: string; message?: string; title?: string } | undefined;
        const errorMessage =
          errorData?.detail ||
          errorData?.message ||
          errorData?.title ||
          axiosError.message ||
          'Unknown error occurred';

        throw new Error(`Failed to fetch {{resourceName}}: ${errorMessage}`);
      }

      if (error instanceof Error) {
        logger.error({
          event: '{{serviceName}}_service_client_unexpected_error',
          err: {
            message: error.message,
            stack: error.stack,
          },
          {{idParameter}},
          correlationId,
        });
        throw error;
      }

      throw new Error('An unexpected error occurred while fetching {{resourceName}}');
    }
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

**Template: Handler** (`templates/handler.hbs`)

**MUST MATCH** the exact structure from `apps/fhir-gateway/src/handlers/patient.ts`:

```handlebars
/**
 * {{Resource}} Handler
 * GET /fhir/{{Resource}}/{{id}}
{{#if hasQueryParams}}
 * Query Parameters: {{queryParamsList}}
{{/if}}
 */

import { APIGatewayProxyevent: any, APIGatewayProxyResult, Context } from 'aws-lambda';
import { to{{Resource}} } from '@api-hub/fhir';
import { {{ServiceName}}ServiceClient, {{Resource}}NotFoundError } from '../services/{{serviceName}}.client';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { problem } from '../utils/response';
import { getAccessTokenFromHeaders } from '../utils/helper';

const baseLogger = createLogger({ service: 'fhir-gateway', redactPII: true });
const {{serviceName}}ServiceClient = new {{ServiceName}}ServiceClient();

export async function main(
  event: APIGatewayProxyevent: any,
  context?: Context
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const {{resourceId}} = event.pathParameters?.{{idParam}};
  {{#if hasQueryParams}}
  {{#each queryParams}}
  const {{variableName}} = event.queryStringParameters?.{{name}};
  {{/each}}
  {{/if}}
  const authHeader = getAccessTokenFromHeaders(event.headers || {});

  if (!{{resourceId}}) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/fhir/{{Resource}}/{{id}}', 400, duration, correlationId);
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: '{{Resource}} ID is required',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  {{#if hasRequiredQueryParams}}
  {{#each requiredQueryParams}}
  if (!{{variableName}}) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/fhir/{{Resource}}/{{id}}', 400, duration, correlationId);
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: '{{description}} is required',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }
  {{/each}}
  {{/if}}

  if (!authHeader) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/fhir/{{Resource}}/{{id}}', 401, duration, correlationId);
    return problem({
      title: 'Unauthorized',
      status: 401,
      detail: 'Access token is required',
      correlationId,
      code: 'UNAUTHORIZED',
    });
  }

  const logger = createChildLogger(baseLogger, { correlationId, {{resourceId}}{{#if hasQueryParams}}, {{queryParamsLogList}}{{/if}}, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'fhir_{{resource}}_get_received' });

  try {
    const {{dtoVariable}} = await {{serviceName}}ServiceClient.get{{Resource}}({{resourceId}}{{#if hasQueryParams}}, {{queryParamsCallList}}{{/if}}, correlationId, authHeader);
    const baseUrl = event.requestContext?.domainName
      ? `https://${event.requestContext.domainName}${event.requestContext.path?.replace(/\/fhir\/{{Resource}}\/.*$/, '') || ''}`
      : undefined;
    const {{resourceVariable}} = to{{Resource}}({{dtoVariable}}{{#if adapterParams}}, {{adapterParamsList}}{{/if}}, baseUrl);

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/{{Resource}}/${ {{resourceId}} }`, 200, duration, correlationId);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/fhir+json',
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify({{resourceVariable}}),
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof {{Resource}}NotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/{{Resource}}/${ {{resourceId}} }`, 404, duration, correlationId);
      return problem({
        title: '{{Resource}} not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: '{{RESOURCE}}_NOT_FOUND',
      });
    }
    logger.error({ event: 'fhir_{{resource}}_get_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/fhir/{{Resource}}/${ {{resourceId}} }`, 500, duration, correlationId);
    return problem({
      title: 'Failed to get {{resource}}',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'GET_{{RESOURCE}}_FAILED',
    });
  }
}
```

**Template: Adapter** (`templates/adapter.hbs`)

**MUST MATCH** the exact structure and patterns from `libs/fhir/src/adapters/identity/patient.adapter.ts`:

```handlebars
/**
 * {{Resource}} Adapter
 * Converts internal {{DTOType}} DTO to FHIR R4 {{Resource}} resource
{{#if autoGenerated}}
 * Auto-generated by FHIR Mapper Generator
{{/if}}
 */

import { {{Resource}} } from '../../models/r4/{{resource}}';
import { {{DTOType}} } from '../../types/internal';
{{#each utilityImports}}
import { {{this}} } from '../../utils/{{@key}}';
{{/each}}
{{#if hasCommonTypes}}
import { {{commonTypesList}} } from '../../models/r4/common';
{{/if}}

/**
 * Convert internal {{DTOType}} to FHIR {{Resource}}
{{#if adapterParams}}
 * @param dto - {{DTOType}} DTO
{{#each adapterParams}}
 * @param {{name}} - {{description}}
{{/each}}
 * @param baseUrl - Base URL for references
{{else}}
 * @param dto - {{DTOType}} DTO
 * @param baseUrl - Base URL for references
{{/if}}
 */
export function to{{Resource}}({{#if adapterParams}}dto: {{DTOType}}, {{adapterParamsSignature}}, baseUrl?: string{{else}}dto: {{DTOType}}, baseUrl?: string{{/if}}): {{Resource}} {
  const {{resource}}Id = dto.{{idField}};

  {{#each mappings}}
  {{#if isArray}}
  // {{description}}
  const {{variableName}}: {{type}}[] = [];
  {{#if condition}}
  if ({{condition}}) {
  {{/if}}
    {{transformation}}
  {{#if condition}}
  }
  {{/if}}
  {{else}}
  {{#if isComplex}}
  // {{description}}
  {{#if condition}}
  if ({{condition}}) {
  {{/if}}
    {{transformation}}
  {{#if condition}}
  }
  {{/if}}
  {{else}}
  // {{description}} - Direct mapping
  {{/if}}
  {{/if}}
  {{/each}}

  const {{resource}}: {{Resource}} = {
    resourceType: '{{Resource}}',
    id: {{resource}}Id,
    {{#each resourceFields}}
    {{#if optional}}...({{variableName}} && {{#if isArray}}({{variableName}}.length > 0 && { {{name}}: {{variableName}} }){{else}}({ {{name}}: {{variableName}} }){{/if}}),{{else}}{{name}}: {{variableName}},{{/if}}
    {{/each}}
    meta: {
      lastUpdated: getCurrentFhirDateTime(),
      ...(baseUrl && { source: baseUrl }),
    },
  };

  return {{resource}};
}

{{#if hasCustomFunctions}}
{{#each customFunctions}}
/**
 * {{description}}
 */
{{#if isPrivate}}private {{else}}export {{/if}}function {{name}}({{parameters}}): {{returnType}} {
  {{code}}
}

{{/each}}
{{/if}}
```

**Reference Implementation:**
- Study `libs/fhir/src/adapters/identity/patient.adapter.ts` for complete pattern
- Study `libs/fhir/src/adapters/identity/practitioner.adapter.ts` for work-specific patterns
- Study `libs/fhir/src/adapters/identity/related-person.adapter.ts` for parameterized adapter pattern

### 4. File Writer & Code Formatting

**Implementation Requirements:**

```typescript
// src/core/file-writer.ts
import prettier from 'prettier';
import * as ts from 'typescript';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

export class FileWriter {
  /**
   * Write formatted TypeScript file
   * - Format with Prettier (matching workspace config)
   * - Validate TypeScript compilation
   * - Create directories if needed
   */
  async writeFile(
    filePath: string,
    content: string,
    options: { format?: boolean; validate?: boolean } = {}
  ): Promise<void>

  /**
   * Update serverless.yml with new function configuration
   * Parse YAML, add function, preserve formatting
   */
  async updateServerlessConfig(
    serverlessPath: string,
    newFunction: ServerlessFunctionConfig
  ): Promise<void>

  /**
   * Update TypeScript index.ts with new exports
   * Parse AST, add export statements, preserve formatting
   */
  async updateIndexExports(
    indexPath: string,
    newExports: string[]
  ): Promise<void>
}
```

**Prettier Configuration** (must match workspace):
```json
{
  "parser": "typescript",
  "singleQuote": true,
  "trailingComma": "es5",
  "tabWidth": 2,
  "printWidth": 100
}
```

### 5. CLI Interface

**Implementation Requirements:**

```typescript
// src/commands/generate.ts
import { Command } from 'commander';

export function registerGenerateCommand(program: Command) {
  program
    .command('generate')
    .alias('gen')
    .description('Generate FHIR mapping code from configuration')
    .requiredOption('-c, --config <path>', 'Path to mapping configuration file (YAML/JSON)')
    .option('-o, --output <path>', 'Output directory (default: workspace root)')
    .option('--dry-run', 'Preview generated code without writing files')
    .option('--no-format', 'Skip code formatting')
    .option('--no-validate', 'Skip TypeScript validation')
    .option('--interactive', 'Interactive mode for configuration')
    .option('--ai-model <model>', 'AI model to use (gpt-4, gpt-3.5-turbo, claude-3-opus)')
    .option('--no-ai', 'Use rule-based mapping only (no AI)')
    .option('--verbose', 'Verbose output')
    .action(async (options) => {
      // Implementation
    });
}
```

**CLI Usage Examples:**
```bash
# Generate from config file
nx fhir-mapper generate -c configs/medication-service.yaml

# Interactive mode
nx fhir-mapper generate --interactive

# Dry run (preview)
nx fhir-mapper generate -c config.yaml --dry-run

# No AI (rule-based only)
nx fhir-mapper generate -c config.yaml --no-ai
```

### 6. Configuration Schema

**JSON Schema** (`schemas/mapping-config.schema.json`):

Must support structure defined in `docs/mapping-config-example.yaml`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "service": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "baseUrl": { "type": "string" },
        "apiEndpoint": { "type": "string" },
        "method": { "type": "string", "enum": ["GET", "POST"], "default": "GET" },
        "responseType": { "type": "string" },
        "authRequired": { "type": "boolean", "default": true },
        "queryParameters": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "type": { "type": "string" },
              "optional": { "type": "boolean" }
            }
          }
        }
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
          "condition": { "type": "string" },
          "utilityFunctions": {
            "type": "array",
            "items": { "type": "string" }
          }
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
          "parameters": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": { "type": "string" },
                "type": { "type": "string" }
              }
            }
          },
          "returnType": { "type": "string" },
          "code": { "type": "string" }
        }
      }
    }
  },
  "required": ["service", "fhirResource", "mappings"]
}
```

## Implementation Steps

### Phase 1: Foundation Setup (Days 1-3)

1. **Create project structure**
   - Set up TypeScript project with strict mode
   - Install dependencies: `commander`, `inquirer`, `handlebars`, `prettier`, `yaml`, `ajv`, `typescript`, `@types/node`
   - Configure ESLint and Prettier to match workspace config

2. **Create configuration schema**
   - Implement JSON Schema validation
   - Create YAML/JSON parser
   - Add schema validation error messages

3. **Set up template engine**
   - Install Handlebars
   - Create template directory structure
   - Register custom Handlebars helpers (camelCase, pascalCase, etc.)

### Phase 2: Pattern Analysis (Days 4-6)

1. **Implement PatternAnalyzer**
   - Use TypeScript Compiler API or regex to parse existing adapters
   - Extract field mappings, transformations, utility usage
   - Build pattern knowledge base
   - Implement similarity matching

2. **Test pattern extraction**
   - Run analyzer on existing adapters
   - Verify extracted patterns match expected structure
   - Refine extraction logic

### Phase 3: AI Integration (Days 7-9)

1. **Implement LLMClient**
   - Set up OpenAI/Anthropic SDK
   - Create prompt templates
   - Implement response parsing
   - Add error handling and retries

2. **Implement FieldMapper**
   - Combine pattern matching with AI generation
   - Try existing patterns first, fall back to AI
   - Cache AI responses for similar mappings

3. **Test AI generation**
   - Test with sample field mappings
   - Verify generated code quality
   - Refine prompts based on results

### Phase 4: Code Generation (Days 10-12)

1. **Create templates**
   - Service client template (matching user-service.client.ts exactly)
   - Handler template (matching patient.ts exactly)
   - Adapter template (matching patient.adapter.ts patterns)
   - Model template (if needed)

2. **Implement CodeGenerator**
   - Template rendering with Handlebars
   - Variable substitution
   - Conditional logic in templates

3. **Test code generation**
   - Generate code for test service
   - Compare with existing implementations
   - Refine templates

### Phase 5: File Operations (Days 13-14)

1. **Implement FileWriter**
   - Prettier integration
   - TypeScript validation
   - Directory creation
   - File writing with error handling

2. **Implement config updaters**
   - Serverless.yml parser/updater
   - TypeScript index.ts AST manipulation
   - Preserve existing formatting

### Phase 6: CLI & Integration (Days 15-16)

1. **Implement CLI commands**
   - Generate command
   - Analyze command
   - Validate command
   - Init command (create config template)

2. **Add interactive mode**
   - Inquirer prompts for configuration
   - Step-by-step wizard

3. **Integration testing**
   - Test end-to-end workflow
   - Test with real service configuration
   - Verify generated code compiles and works

## Key Constraints & Requirements

### Code Style Requirements

1. **MUST match existing code style exactly:**
   - Single quotes for strings
   - Trailing commas (ES5 style)
   - 2-space indentation
   - No semicolons (if workspace uses this)
   - Max line length: 100 characters

2. **TypeScript Requirements:**
   - Strict mode enabled
   - No `any` types (use `unknown` if needed)
   - Proper type imports
   - Generic type parameters where appropriate

3. **Error Handling:**
   - Custom error classes extending Error
   - Proper error logging with structured logging
   - HTTP status code mapping (401, 403, 404, 429, 500)

4. **Logging Patterns:**
   - Use `@api-hub/logger` package
   - Structured logging with event names
   - Include correlation IDs
   - Redact PII in logs
   - Use `createChildLogger` in handlers

### Naming Conventions

- **Service Clients**: `{ServiceName}ServiceClient` (e.g., `MedicationServiceClient`)
- **Handlers**: File name `{resource}.ts`, function `main`
- **Adapters**: Function name `to{Resource}` (e.g., `toMedication`)
- **Error Classes**: `{Resource}NotFoundError`
- **Event Names**: `fhir_{resource}_get_received`, `fhir_{resource}_get_error`
- **HTTP Paths**: `/fhir/{Resource}/{id}`

### File Structure Requirements

**Generated files MUST be placed in:**
- Service Clients: `apps/fhir-gateway/src/services/{service-name}.client.ts`
- Handlers: `apps/fhir-gateway/src/handlers/{resource-name}.ts`
- Adapters: `libs/fhir/src/adapters/{category}/{resource-name}.adapter.ts`
- Models: `libs/fhir/src/models/r4/{resource-name}.ts` (if new resource type)

**MUST update:**
- `apps/fhir-gateway/serverless.yml` - Add new function
- `libs/fhir/src/index.ts` - Export new adapter
- `apps/fhir-gateway/src/index.ts` - Export handler (if applicable)

## Testing Requirements

### Unit Tests

- Pattern analyzer extraction
- Code generator template rendering
- Field mapper pattern matching
- File writer formatting

### Integration Tests

- End-to-end code generation
- Generated code compilation
- Serverless.yml updates
- Index file updates

### Validation Tests

- TypeScript compilation of generated code
- ESLint compliance
- Pattern consistency checks

## Deliverables

1. **Working CLI tool** with generate, analyze, validate commands
2. **Template files** for all code generation
3. **Configuration schema** with validation
4. **Documentation** (README with usage examples)
5. **Test suite** (unit + integration tests)
6. **Example configurations** for common scenarios

## Success Criteria

✅ Generated code **compiles** without TypeScript errors  
✅ Generated code **matches** existing patterns exactly  
✅ Generated code **passes** ESLint rules  
✅ Generated code **follows** workspace conventions  
✅ Tool can generate code for **all 8 mapping pattern types**  
✅ Tool **updates** serverless.yml and index files correctly  
✅ Tool provides **clear error messages** for invalid configurations  
✅ Tool **validates** generated code before writing  

## Additional Notes

- **Prioritize correctness over speed** - Generated code must be production-ready
- **Preserve existing code style** - Don't reformat existing files unnecessarily
- **Provide helpful error messages** - Guide users to fix configuration issues
- **Support incremental generation** - Allow updates to existing generated code
- **Document all templates** - Add comments explaining template variables

## Reference Implementation Checklist

Before generating code, verify understanding of:

- [ ] Service client structure (`user-service.client.ts`)
- [ ] Handler structure (`patient.ts`, `practitioner.ts`, `related-person.ts`)
- [ ] Adapter patterns (all three adapter files)
- [ ] Utility function usage (`coding.ts`, `reference.ts`, `date.ts`)
- [ ] Error handling patterns
- [ ] Logging patterns
- [ ] Serverless.yml structure
- [ ] Type definitions (`common.ts`, resource types)
- [ ] Configuration file structure (`mapping-config-example.yaml`)

## Start Implementation

Begin with Phase 1 and implement incrementally. Test each phase before moving to the next. Use the existing code files as the **single source of truth** for patterns and structure.

**Remember**: The goal is to generate code that is **indistinguishable** from manually written code following the same patterns.

