import { APIGatewayProxyEvent } from "aws-lambda"; 
import { FhirExtension } from "src/mapper/extension.builder";
import { FhirValidator } from "src/validator/fhir.validator";
 

  
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
}
export interface UserContext {
  userId?: string;
  organizationId?: string;
  authHeader?: string;
}
 
export interface ResourceDefinition {

  resourceType:string;

  mapping:any;

  detector?(
     payload:any
  ):boolean;

  validator?:FhirValidator;

  profile?:string;

  extensions?:FhirExtension[];
}