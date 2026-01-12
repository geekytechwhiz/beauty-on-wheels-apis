import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import mappingConfigSchema from '../schemas/mapping-config.schema.json' with { type: 'json' };

export interface ServiceConfig {
  name: string;
  baseUrl?: string;
  apiEndpoint: string;
  method?: 'GET' | 'POST';
  responseType?: string;
  authRequired?: boolean;
  queryParameters?: Array<{
    name: string;
    type: string;
    optional?: boolean;
    description?: string;
  }>;
}

export interface FhirResourceConfig {
  resourceType: string;
  category?: string;
  path?: string;
}

export interface FieldMapping {
  source: string;
  target: string;
  transformation?: string;
  optional?: boolean;
  condition?: string;
  utilityFunctions?: string[];
  description?: string;
  isArray?: boolean;
  isComplex?: boolean;
}

export interface CustomTransformation {
  name: string;
  parameters?: Array<{ name: string; type: string }>;
  returnType?: string;
  code: string;
  description?: string;
  isPrivate?: boolean;
}

export interface MappingConfig {
  service: ServiceConfig;
  fhirResource: FhirResourceConfig;
  mappings: FieldMapping[];
  customTransformations?: CustomTransformation[];
  generation?: {
    generateFiles?: string[];
    options?: {
      addComments?: boolean;
      addJSDoc?: boolean;
      includeValidation?: boolean;
      formatCode?: boolean;
    };
  };
  ai?: {
    enabled?: boolean;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    useForMissingMappings?: boolean;
  };
}

export class ConfigParser {
  private ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
  }

  /**
   * Parse configuration file (YAML or JSON)
   */
  parseConfig(filePath: string): MappingConfig {
    const fileContent = readFileSync(filePath, 'utf-8');
    let config: unknown;

    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      config = parseYaml(fileContent);
    } else if (filePath.endsWith('.json')) {
      config = JSON.parse(fileContent);
    } else {
      throw new Error(`Unsupported file format. Expected .yaml, .yml, or .json`);
    }

    // Validate against schema
    const validate = this.ajv.compile(mappingConfigSchema);
    const valid = validate(config);

    if (!valid) {
      const errors = validate.errors
        ?.map((err: { instancePath: string; message?: string }) => `${err.instancePath} ${err.message || ''}`)
        .join('\n');
      throw new Error(`Invalid configuration file:\n${errors}`);
    }

    return config as MappingConfig;
  }

  /**
   * Validate configuration object
   */
  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    const validate = this.ajv.compile(mappingConfigSchema);
    const valid = validate(config);

    if (!valid) {
      const errors = validate.errors?.map(
        (err: { instancePath?: string; message?: string }) => `${err.instancePath || '/'} ${err.message || ''}`
      ) || [];
      return { valid: false, errors };
    }

    return { valid: true };
  }
}

