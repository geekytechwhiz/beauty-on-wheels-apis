# FHIR Mapper Generator

AI-powered CLI tool for automatically generating FHIR response mapping code for microservices in an Nx monorepo.

## Overview

This tool analyzes existing patterns from `user-service` and `fhir-gateway` applications and generates production-ready code (Service Clients, Handlers, Adapters) that follows the exact same patterns, conventions, and architecture.

## Features

- 🎯 **Pattern Analysis**: Analyzes existing adapters to learn mapping patterns
- 🤖 **AI-Powered**: Uses LLM (GPT-4, Claude, etc.) for complex field mappings
- 📝 **Template-Based**: Generates code using Handlebars templates matching existing patterns
- ✅ **Validation**: Validates configuration and generated TypeScript code
- 🔧 **Interactive Mode**: Step-by-step wizard for creating configurations

## Installation

```bash
cd tools/fhir-mapper-generator
pnpm install
pnpm build
```

## Usage

### Generate Code from Configuration

```bash
# Using the built tool
node dist/index.js generate -c configs/medication-service.yaml

# Or after installing globally
fhir-mapper generate -c configs/medication-service.yaml
```

### Initialize Configuration Template

```bash
fhir-mapper init medication-service -o configs/medication-service.yaml
```

### Generate Configuration from serverless.yml

```bash
# Extract configuration from existing serverless.yml
fhir-mapper from-serverless -s apps/user-service/serverless.yml -f getUser -o configs/user-mapping.yaml

# Interactive mode to select function
fhir-mapper from-serverless -s apps/user-service/serverless.yml --interactive
```

### Analyze Existing Patterns

```bash
fhir-mapper analyze -o patterns.json --verbose
```

### Validate Configuration

```bash
fhir-mapper validate -c configs/medication-service.yaml
```

### Interactive Mode

```bash
fhir-mapper generate --interactive
```

## Configuration File Structure

See `docs/mapping-config-example.yaml` for a complete example.

### Basic Structure

```yaml
service:
  name: "medication-service"
  apiEndpoint: "/medications/{id}"
  responseType: "MedicationDTO"

fhirResource:
  resourceType: "Medication"
  category: "medication"

mappings:
  - source: "medicationId"
    target: "id"
  - source: "status"
    target: "status"
    transformation: "mapStatus(dto.status)"
```

## Generated Files

The tool generates:

1. **Service Client** (`apps/fhir-gateway/src/services/{service-name}.client.ts`)
   - Axios-based HTTP client
   - Error handling
   - Authorization support

2. **Handler** (`apps/fhir-gateway/src/handlers/{resource-name}.ts`)
   - AWS Lambda handler
   - Request validation
   - FHIR response formatting

3. **Adapter** (`libs/fhir/src/adapters/{category}/{resource-name}.adapter.ts`)
   - DTO to FHIR transformation
   - Field mappings
   - Utility function usage

## Commands

### `generate` / `gen`

Generate FHIR mapping code from configuration.

**Options:**
- `-c, --config <path>` - Path to mapping configuration file (required)
- `-o, --output <path>` - Output directory (default: workspace root)
- `--dry-run` - Preview generated code without writing files
- `--no-format` - Skip code formatting
- `--no-validate` - Skip TypeScript validation
- `--interactive` - Interactive mode
- `--ai-model <model>` - AI model to use
- `--no-ai` - Use rule-based mapping only

### `analyze`

Analyze existing adapter patterns in the codebase.

**Options:**
- `-o, --output <path>` - Output file for analysis results (JSON)
- `--verbose` - Verbose output

### `validate`

Validate configuration file or generated code.

**Options:**
- `-c, --config <path>` - Validate configuration file
- `-f, --file <path>` - Validate generated TypeScript file

### `init`

Generate a configuration template file.

**Arguments:**
- `[service-name]` - Service name (e.g., medication-service)

**Options:**
- `-o, --output <path>` - Output file path (default: mapping-config.yaml)

### `from-serverless` / `from-sls`

Generate FHIR mapping configuration from an existing serverless.yml file.

**Options:**
- `-s, --serverless <path>` - Path to serverless.yml file (required)
- `-f, --function <name>` - Specific function name to extract (optional)
- `-o, --output <path>` - Output configuration file path
- `--interactive` - Interactive mode to select function and configure

**Example:**
```bash
# Extract from specific function
fhir-mapper from-serverless -s apps/user-service/serverless.yml -f getUser -o user-mapping.yaml

# Interactive selection
fhir-mapper from-serverless -s apps/user-service/serverless.yml --interactive
```

## Development

### Build

```bash
pnpm build
```

### Development Mode

```bash
pnpm dev
```

## Architecture

```
tools/fhir-mapper-generator/
├── src/
│   ├── commands/          # CLI commands
│   ├── core/              # Core logic
│   │   ├── config-parser.ts
│   │   ├── pattern-analyzer.ts
│   │   ├── code-generator.ts
│   │   └── file-writer.ts
│   ├── templates/         # Handlebars templates
│   │   ├── service-client.hbs
│   │   ├── handler.hbs
│   │   └── adapter.hbs
│   ├── schemas/           # JSON schemas
│   └── index.ts           # CLI entry point
```

## Reference Documentation

- `docs/FHIR_MAPPING_AI_AGENT_GUIDE.md` - Complete implementation guide
- `docs/PATTERN_ANALYSIS.md` - Pattern analysis documentation
- `docs/QUICK_START_AI_AGENT.md` - Quick reference guide
- `docs/mapping-config-example.yaml` - Example configuration

## License

MIT

