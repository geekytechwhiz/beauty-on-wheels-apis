export type ResourceConfig = {
    resource: string;
  
    version: string;
  
    profile: string[];
  
    validation: any;
  
    detection: any;
  
    mapping: any;
  
    aliases: any;
  
    references: any[];
  
    extensions: any[];
  
    transformers: any[];
  
    clientOverrides: boolean;
  
    metadata: any;
    fields: MappingField[];
  }
 
  export interface ValidationConfig{

    requiredFields:string[]
   
    profile?:string[]
   
   }
   
   export interface DetectionConfig{
   
    enabled:boolean
   
    strategy:'ANY'|'ALL'
   
    fields:string[]
   
   }
   
   export interface MappingConfig{
   
    file:string
   
   }
   
   
export interface FhirTransformationConfig {
    baseUrl?: string;
  
    validate?: boolean;
  
    clientConfig?: Record<string, unknown>;
  
    version?: 'R4' | 'R5';
  }
  
  export interface FhirProjectionOptions {
    resourceTypes?: string[];
  
    clientId?: string;
  
    version?: 'R4' | 'R5';
  }

  export type FieldType =
  | 'string'
  | 'boolean'
  | 'number'
  | 'integer'
  | 'date'
  | 'datetime'
  | 'array'
  | 'object'
  | 'reference'
  | 'identifier'
  | 'coding'
  | 'extension';

export interface TransformConfig {
  name:
    | 'formatDate'
    | 'normalizePhone'
    | 'convertGender'
    | 'convertCode'
    | 'trim'
    | 'concat'
    | 'split'
    | 'firstName'
    | 'lastName'
    | 'dateOfBirth';

  params?: Record<string, unknown>;
}

export interface ExtensionMapping {
  source: string;
  url: string;
  valueType: 'boolean' | 'integer' | 'date' | 'code' | 'json' | 'string';
}

export interface MappingField {
 
  source: string;
 
  target: string;
 
  fieldType: FieldType;
 
  required?: boolean;
 
  defaultValue?: unknown;
 
  system?: string;
 
  template?: string;
 
  transform?: TransformConfig;
 
  skipIfEmpty?: boolean;

 
  isArray?: boolean;

 
  metadata?: Record<string, unknown>;
} 
export interface ClientMappingRegistry {

  register(
    clientId: string,
    config: ResourceConfig
  ): void;


  get(
    clientId: string,
    resource: string,
    version?: string
  ): ResourceConfig | undefined;


  has(
    clientId: string,
    resource: string,
    version?: string
  ): boolean;


  getAll(
    clientId: string
  ): ResourceConfig[];

}

export interface ResourceMappingConfig {
  resource: string; 
  version: string;  
  profile?: string; 
  fields: MappingField[]; 
  extensions?: MappingField[]; 
  metadata?: {

      author?: string;

      description?: string;

      generated?: boolean;

      generatedAt?: string;

  }
}