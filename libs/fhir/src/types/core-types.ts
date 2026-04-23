import { APIGatewayProxyEvent } from "aws-lambda"; 
 

  
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
  /**
   * When using `withLambdaHandler` with `fhir.resourceTypeFromContext`, the handler
   * sets this after loading the user (e.g. `"Patient"` | `"Practitioner"`).
   */
  fhirResourceType?: string;
}
export interface UserContext {
  userId?: string;
  organizationId?: string;
  authHeader?: string;
}
 