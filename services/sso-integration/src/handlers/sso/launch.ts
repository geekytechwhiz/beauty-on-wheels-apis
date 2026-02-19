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
import { LaunchService } from '../../services/launch.service';
import { logger } from '../../utils/logger';
import { errorResponse } from '../../utils/response';

const launchService = new LaunchService();
const APP_BASE_URL = process.env.APP_BASE_URL || process.env.MYVITALRX_APP_URL || 'https://app.myvitalrx.com';

export async function handler(
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> {
  try {
    const params = event.queryStringParameters || {};
    const launchToken = params.launch_token || params.launchToken;
    const redirectUri = params.redirect_uri || params.redirectUri;
    const state = params.state || '';

    if (!launchToken) {
      logger.warn('Launch endpoint called without launch_token');
      return errorResponse('Missing launch_token', 400, 'INVALID_REQUEST');
    }

    const result = await launchService.processLaunch(launchToken);

    if (!result) {
      logger.warn('Launch token verification failed');
      return errorResponse('Invalid or expired launch token', 401, 'INVALID_LAUNCH_TOKEN');
    }

    const { sessionToken, userId, hmsId } = result;

    // Build redirect URL
    const baseUrl = redirectUri || APP_BASE_URL;
    const redirectUrl = new URL(baseUrl);

    // Pass session via fragment (recommended - not sent to server) or query
    // Using query for compatibility with all clients; consider fragment for SPAs
    redirectUrl.searchParams.set('session_token', sessionToken);
    redirectUrl.searchParams.set('sso', 'true');
    if (state) redirectUrl.searchParams.set('state', state);

    logger.info('SSO launch successful', { userId, hmsId });

    return {
      statusCode: 302,
      headers: {
        Location: redirectUrl.toString(),
        'Cache-Control': 'no-store, no-cache',
      },
      body: '',
    };
  } catch (error) {
    logger.error('Launch error', error as Error, { queryParams: event.queryStringParameters });
    return errorResponse('Launch failed', 500, 'SERVER_ERROR');
  }
}
