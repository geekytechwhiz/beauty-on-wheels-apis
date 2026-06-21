import { APIGatewayProxyResult } from 'aws-lambda';
import {
  ApiResponse,
  type FhirValidationResponse,
  type Message,
} from '@api-hub/utils';

interface ResponseOptions {
  correlationId?: string;
  fhir?: unknown;
  fhirValidation?: FhirValidationResponse;
}

/**
 * Standard success response
 */
export const successResponse = <T>(
  data: T,
  message: Message = {
    title: 'SUCCESS',
    description: 'Request processed successfully',
    severity: 'SUCCESS',
  },
  options: ResponseOptions = {}
): APIGatewayProxyResult => {
 
  const requestId = options.correlationId ?? 'unknown';

  return ApiResponse.ok<T>(
    data,
    message,
    {
      correlationId: requestId,
      fhir: options.fhir,
      fhirValidation: options.fhirValidation,
    },
  );
};

/**
 * Resource created response
 */
export const createdResponse = <T>(
  data: T,
  message: Message = {
    title: 'RESOURCE_CREATED',
    description: 'Resource created successfully',
    severity: 'SUCCESS',
  },
  options: ResponseOptions = {}
): APIGatewayProxyResult => {

  const requestId = options.correlationId ?? 'unknown';

  return ApiResponse.created<T>(
    data,
    message,
    { correlationId:requestId }
  );
};

/**
 * 204 No Content response
 */
export const noContentResponse = (): APIGatewayProxyResult => {
  return {
    statusCode: 204,
    headers: {
      'Content-Type': 'application/json',
    },
    body: '',
  };
};
