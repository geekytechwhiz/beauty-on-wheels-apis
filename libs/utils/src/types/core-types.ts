import { APIGatewayProxyEvent } from "aws-lambda"; 

export type Severity = 'SUCCESS' | 'INFO' | 'WARNING' | 'ERROR';

export interface Message {
  title: string;
  description: string;
  severity: Severity;
}

export interface Meta {
  requestId: string;
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
  error: ErrorBody | null;
  meta: Meta;
}

export interface ResponseOptions {
  requestId: string;
  headers?: Record<string, string>;
}

export interface ErrorHandlerOptions {
    correlationId?: string;
    event?: any;
    logger?: any;
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
}
export interface RequestContext {
  correlationId: string;
  awsRequestId: string;
  logger: any;
  authHeader?: string;
  userContext?: UserContext;
}
export interface UserContext {
  userId?: string;
  organizationId?: string;
  authHeader?: string;
}


export interface Params {
  [key: string]: unknown;
}
