import { APIGatewayProxyEvent } from 'aws-lambda'; 

export type Severity = 'SUCCESS' | 'INFO' | 'WARNING' | 'ERROR';

export interface Message {
  title: string;
  description: string;
  severity: Severity;
}

export interface Meta {
  correlationId: string;
  timestamp: string;
  version: 'v1';
}

export interface ErrorDetail {
  code?: string;
  field?: string;
  message: string;
}

export interface ErrorBody {
  code?: string;
  details?: ErrorDetail[];
}

export interface ApiResponseBody<T = unknown> {
  success: boolean;
  statusCode: number;
  message: Message;
  data: T | null;
  fhir?: unknown;
  error: ErrorBody | null;
  meta: Meta;
}

export interface ResponseOptions {
  correlationId: string;
  headers?: Record<string, string>;
  /** Optional FHIR projection (collection Bundle) alongside canonical data. */
  fhir?: unknown;
  /** Optional event passthrough for error handlers (e.g. API Gateway event). */
  event?: unknown;
}

export interface ErrorHandlerOptions {
    correlationId?: string;
    event?: any;
    logger?: any;
    /** When true, {@link handleError} omits its own log line (caller already logged structured error). */
    skipLog?: boolean;
  }
  
  export interface LambdaRequest<
  Params = Record<string, any>,
  Body = any,
  Query = Record<string, any>
> {
  event: APIGatewayProxyEvent;
  params: Params;
  body?: Body;
  query?: Query;
  context: RequestContext;
  pathParameters?: Record<string, string>; 
}
export interface RequestContext {
  correlationId: string;
  awsRequestId: string;
  logger: any;
  authHeader?: string;
  userContext?: UserContext;
  traceId?: string;
  operation?: string;
}
export interface UserContext {
  userId?: string;
  organizationId?: string;
  authHeader?: string;
}


export interface Params {
  [key: string]: unknown;
}
