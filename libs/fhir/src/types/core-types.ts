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
}
export interface UserContext {
  userId?: string;
  organizationId?: string;
  authHeader?: string;
}
 