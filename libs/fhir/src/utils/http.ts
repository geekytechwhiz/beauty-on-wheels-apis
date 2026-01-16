/**
 * FHIR HTTP Response Utilities
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { Resource } from '../models/r4/common';

// Bundle type definition
interface Bundle extends Resource {
  resourceType: 'Bundle';
  type: 'document' | 'message' | 'transaction' | 'transaction-response' | 'batch' | 'batch-response' | 'history' | 'searchset' | 'collection';
  total?: number;
  link?: Array<{
    relation: string;
    url: string;
  }>;
  entry?: Array<{
    fullUrl?: string;
    resource?: Resource;
  }>;
}

/**
 * Extract base URL from API Gateway event
 */
export function getBaseUrl(event: APIGatewayProxyEvent): string {
  const protocol = event.headers?.['X-Forwarded-Proto'] || 'https';
  const host = event.headers?.['Host'] || event.requestContext?.domainName || '';
  const stage = event.requestContext?.stage || '';
  
  if (!host) {
    return '';
  }
  
  const baseUrl = `${protocol}://${host}`;
  return stage ? `${baseUrl}/${stage}` : baseUrl;
}

/**
 * Create a successful FHIR resource response (200 OK)
 */
export function fhirOk(
  resource: Resource,
  options?: { correlationId?: string }
): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/fhir+json',
      'Cache-Control': 'no-cache',
      ...(options?.correlationId && { 'X-Correlation-Id': options.correlationId }),
    },
    body: JSON.stringify(resource),
  };
}

/**
 * Create a FHIR Bundle response
 */
export function fhirBundle(
  resources: Resource[],
  options?: { correlationId?: string; type?: 'searchset' | 'collection' | 'history' | 'document' | 'message'; baseUrl?: string }
): APIGatewayProxyResult {
  const baseUrl = options?.baseUrl || '';
  
  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: options?.type || 'searchset',
    total: resources.length,
    entry: resources.map((resource) => ({
      resource,
      fullUrl: resource.id && baseUrl ? `${baseUrl}/${resource.resourceType}/${resource.id}` : undefined,
    })),
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/fhir+json',
      'Cache-Control': 'no-cache',
      ...(options?.correlationId && { 'X-Correlation-Id': options.correlationId }),
    },
    body: JSON.stringify(bundle),
  };
}

/**
 * FHIR Error Handler
 */
export class FhirErrorHandler {
  /**
   * Handle errors and return FHIR OperationOutcome
   */
  static handle(
    error: Error | unknown,
    event: APIGatewayProxyEvent,
    correlationId?: string
  ): APIGatewayProxyResult {
    const err = error instanceof Error ? error : new Error(String(error));
    const statusCode = this.getStatusCode(err);
    
    const operationOutcome: Resource & {
      resourceType: 'OperationOutcome';
      issue: Array<{
        severity: 'error' | 'warning' | 'information';
        code: string;
        details?: {
          text?: string;
        };
      }>;
    } = {
      resourceType: 'OperationOutcome',
      issue: [
        {
          severity: 'error',
          code: this.getErrorCode(err),
          details: {
            text: err.message || 'An error occurred',
          },
        },
      ],
    };

    return {
      statusCode,
      headers: {
        'Content-Type': 'application/fhir+json',
        'Cache-Control': 'no-cache',
        ...(correlationId && { 'X-Correlation-Id': correlationId }),
      },
      body: JSON.stringify(operationOutcome),
    };
  }

  /**
   * Determine HTTP status code from error
   */
  private static getStatusCode(error: Error): number {
    // Check for common error patterns
    if (error.message.includes('not found') || error.message.includes('Not Found')) {
      return 404;
    }
    if (error.message.includes('unauthorized') || error.message.includes('Unauthorized')) {
      return 401;
    }
    if (error.message.includes('forbidden') || error.message.includes('Forbidden')) {
      return 403;
    }
    if (error.message.includes('bad request') || error.message.includes('Bad Request')) {
      return 400;
    }
    if (error.message.includes('conflict') || error.message.includes('Conflict')) {
      return 409;
    }
    // Default to 500 for server errors
    return 500;
  }

  /**
   * Get FHIR error code from error
   */
  private static getErrorCode(error: Error): string {
    if (error.message.includes('not found')) {
      return 'not-found';
    }
    if (error.message.includes('unauthorized')) {
      return 'security';
    }
    if (error.message.includes('forbidden')) {
      return 'forbidden';
    }
    if (error.message.includes('bad request')) {
      return 'invalid';
    }
    if (error.message.includes('conflict')) {
      return 'duplicate';
    }
    return 'exception';
  }
}
