import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from "aws-lambda";

/**
 * Extract Accept-Language header from API Gateway event
 * Supports both v1 and v2 event formats
 * 
 * @param event - API Gateway event (v1 or v2)
 * @returns Language code from Accept-Language header, or null if not present
 */
export function extractLanguageFromEvent(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): string | null {
  // API Gateway v2 format
  if ("headers" in event && event.headers) {
    // Headers in v2 are lowercase
    const acceptLanguage =
      event.headers["accept-language"] ||
      event.headers["Accept-Language"] ||
      event.headers["x-language"] ||
      event.headers["X-Language"];
    
    if (acceptLanguage) {
      return acceptLanguage;
    }
  }

  // API Gateway v1 format
  if ("multiValueHeaders" in event && event.multiValueHeaders) {
    const acceptLanguage =
      event.multiValueHeaders["Accept-Language"]?.[0] ||
      event.multiValueHeaders["accept-language"]?.[0] ||
      event.multiValueHeaders["X-Language"]?.[0] ||
      event.multiValueHeaders["x-language"]?.[0];
    
    if (acceptLanguage) {
      return acceptLanguage;
    }
  }

  // Fallback to regular headers in v1
  if ("headers" in event && event.headers) {
    const acceptLanguage =
      event.headers["Accept-Language"] ||
      event.headers["accept-language"] ||
      event.headers["X-Language"] ||
      event.headers["x-language"];
    
    if (acceptLanguage) {
      return acceptLanguage;
    }
  }

  return null;
}

/**
 * Extract a specific header value from API Gateway event
 * Supports both v1 and v2 event formats
 * 
 * @param event - API Gateway event (v1 or v2)
 * @param headerName - Name of the header to extract (case-insensitive)
 * @returns Header value or null if not present
 */
export function extractHeader(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
  headerName: string
): string | null {
  const normalizedName = headerName.toLowerCase();

  // API Gateway v2 format
  if ("headers" in event && event.headers) {
    // Headers in v2 are lowercase
    const value = event.headers[normalizedName] || event.headers[headerName];
    if (value) {
      return value;
    }
  }

  // API Gateway v1 format
  if ("multiValueHeaders" in event && event.multiValueHeaders) {
    const value =
      event.multiValueHeaders[headerName]?.[0] ||
      event.multiValueHeaders[normalizedName]?.[0];
    if (value) {
      return value;
    }
  }

  // Fallback to regular headers in v1
  if ("headers" in event && event.headers) {
    const value = event.headers[headerName] || event.headers[normalizedName];
    if (value) {
      return value;
    }
  }

  return null;
}

/**
 * Extract multiple headers from API Gateway event
 * 
 * @param event - API Gateway event (v1 or v2)
 * @param headerNames - Array of header names to extract
 * @returns Object with header names as keys and values as values
 */
export function extractHeaders(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
  headerNames: string[]
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  
  for (const headerName of headerNames) {
    result[headerName] = extractHeader(event, headerName);
  }
  
  return result;
}

