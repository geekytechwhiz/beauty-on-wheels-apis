/**
 * HMS Registration Endpoint
 * Register HMS to get client credentials and launch_secret for SSO
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
export declare function handler(event: APIGatewayProxyEvent, _context: Context): Promise<APIGatewayProxyResult>;
