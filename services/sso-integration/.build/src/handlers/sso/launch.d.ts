/**
 * SSO Launch Endpoint
 *
 * HMS redirects users here to initiate SSO. No changes required on HMS side -
 * they simply redirect to this URL with a launch_token they generate.
 *
 * Query params:
 *   - launch_token (required): JWT signed by HMS with shared launch_secret
 *   - redirect_uri (optional): Where to send user after session creation
 *   - state (optional): CSRF/state preservation
 *
 * Launch token payload (HMS generates):
 *   - sub: user id
 *   - hmsId: hospital/system id
 *   - clientId: HMS client_id from registration
 *   - email, name, roles, permissions (optional)
 *   - iat, exp (standard JWT)
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
export declare function handler(event: APIGatewayProxyEvent, _context: Context): Promise<APIGatewayProxyResult>;
