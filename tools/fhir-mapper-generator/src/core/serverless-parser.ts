import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';

export interface ServerlessFunction {
  name: string;
  handler: string;
  path?: string;
  method?: string;
  pathParameters?: Array<{
    name: string;
    description?: string;
  }>;
  queryParameters?: Array<{
    name: string;
    type?: string;
    optional?: boolean;
    description?: string;
  }>;
  documentation?: {
    summary?: string;
    description?: string;
    pathParameters?: Array<{
      name: string;
      description?: string;
    }>;
    queryParameters?: Array<{
      name: string;
      type?: string;
      description?: string;
    }>;
  };
}

export interface ServerlessConfig {
  service: string;
  provider?: {
    environment?: Record<string, string>;
  };
  functions?: Record<string, ServerlessFunction>;
}

export class ServerlessParser {
  /**
   * Parse serverless.yml file
   */
  parseServerlessFile(filePath: string): ServerlessConfig {
    const content = readFileSync(filePath, 'utf-8');
    const config = parseYaml(content) as ServerlessConfig;
    return config;
  }

  /**
   * Extract GET functions that could be mapped to FHIR resources
   */
  extractGetFunctions(config: ServerlessConfig): ServerlessFunction[] {
    const functions: ServerlessFunction[] = [];

    if (!config.functions) {
      return functions;
    }

    for (const [name, func] of Object.entries(config.functions)) {
      // Parse handler to get path
      const handlerPath = func.handler || '';
      
      // Extract events
      const events = (func as any).events || [];
      
      for (const event of events) {
        if (event.http) {
          const httpEvent = event.http;
          const method = (httpEvent.method || 'get').toLowerCase();
          
          // Only process GET requests with path parameters (likely resource endpoints)
          if (method === 'get' && httpEvent.path) {
            const path = httpEvent.path;
            
            // Check if path has parameters (e.g., /user/{userId})
            if (path.includes('{') && path.includes('}')) {
              functions.push({
                name,
                handler: handlerPath,
                path: httpEvent.path,
                method: 'GET',
                pathParameters: this.extractPathParameters(path),
                queryParameters: this.extractQueryParameters(httpevent: any, func),
                documentation: httpEvent.documentation || (func as any).documentation,
              });
            }
          }
        }
      }
    }

    return functions;
  }

  /**
   * Extract path parameters from path string
   */
  private extractPathParameters(path: string): Array<{ name: string; description?: string }> {
    const params: Array<{ name: string; description?: string }> = [];
    const paramRegex = /\{(\w+)\}/g;
    let match;

    while ((match = paramRegex.exec(path)) !== null) {
      params.push({
        name: match[1],
      });
    }

    return params;
  }

  /**
   * Extract query parameters from event or documentation
   */
  private extractQueryParameters(
    httpEvent: any,
    func: any
  ): Array<{ name: string; type?: string; optional?: boolean; description?: string }> {
    const params: Array<{ name: string; type?: string; optional?: boolean; description?: string }> = [];

    // Try to extract from documentation
    const doc = httpEvent.documentation || func.documentation;
    if (doc?.queryParameters) {
      for (const param of doc.queryParameters) {
        params.push({
          name: param.name,
          type: param.schema?.type || 'string',
          optional: !param.required,
          description: param.description,
        });
      }
    }

    return params;
  }

  /**
   * Infer FHIR resource type from function name and path
   */
  inferFhirResourceType(functionName: string, path: string): {
    resourceType: string;
    category: string;
    path: string;
  } {
    // Remove common prefixes (get, fetch, retrieve)
    const cleanName = functionName
      .replace(/^(get|fetch|retrieve)/i, '')
      .replace(/^[a-z]/, (char) => char.toUpperCase());

    // Convert to PascalCase
    const resourceType = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);

    // Infer category from path or resource type
    let category = 'identity';
    if (path.includes('medication')) category = 'medication';
    else if (path.includes('observation')) category = 'observation';
    else if (path.includes('patient')) category = 'identity';
    else if (path.includes('practitioner')) category = 'identity';
    else if (path.includes('organization')) category = 'identity';

    // Extract path segment (e.g., /user/{id} -> user)
    const pathSegment = path.split('/').filter(Boolean)[0] || resourceType.toLowerCase();

    return {
      resourceType,
      category,
      path: pathSegment,
    };
  }

  /**
   * Generate service name from serverless service name
   */
  generateServiceName(serviceName: string): string {
    return serviceName.replace(/_/g, '-');
  }

  /**
   * Infer API endpoint from serverless path
   */
  inferApiEndpoint(path: string, _serviceName: string): string {
    // Convert serverless path to microservice API endpoint
    // e.g., /user/{userId} -> /users/{id} or /get-user-details?userID={id}
    
    // Common patterns
    if (path.includes('{userId}')) {
      return `/get-user-details?userID={id}`;
    }
    
    // Generic pattern: convert to microservice endpoint format
    const segments = path.split('/').filter(Boolean);
    const resourceName = segments[0];
    const paramName = path.match(/\{(\w+)\}/)?.[1] || 'id';
    
    return `/${resourceName}s/{${paramName}}`;
  }
}

