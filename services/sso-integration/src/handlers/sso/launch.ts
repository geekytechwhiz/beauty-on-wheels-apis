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
import { LaunchService, isLaunchResultWithCognito } from '../../services/launch.service';
import { HMSClientService } from '../../services/hms-client.service';
import { logger } from '../../utils/logger';
import { errorResponse } from '../../utils/response';

const launchService = new LaunchService();
const hmsClientService = new HMSClientService();
const APP_BASE_URL = process.env.APP_BASE_URL || process.env.MYVITALRX_APP_URL || 'https://app.myvitalrx.com';

/**
 * Validates redirect_uri against client's allowed redirect URIs or global allowlist
 * Returns validated redirect URI or null if invalid
 */
async function validateRedirectUri(
  redirectUri: string | undefined,
  clientId: string | undefined,
  defaultUri: string
): Promise<string> {
  // If no redirect_uri provided, use default
  if (!redirectUri) {
    return defaultUri;
  }

  // Basic URL validation
  let parsedUri: URL;
  try {
    parsedUri = new URL(redirectUri);
  } catch {
    logger.warn('Invalid redirect_uri format', { redirectUri });
    return defaultUri; // Fallback to default on invalid URL
  }

  // If we have a clientId, check against client's allowed redirectUris
  if (clientId) {
    const client = await hmsClientService.getClient(clientId);
    if (client && client.redirectUris && client.redirectUris.length > 0) {
      const isAllowed = client.redirectUris.some((allowedUri) => {
        try {
          const allowed = new URL(allowedUri);
          // Match scheme, host, and port (path can vary)
          return (
            allowed.protocol === parsedUri.protocol &&
            allowed.hostname === parsedUri.hostname &&
            allowed.port === parsedUri.port
          );
        } catch {
          return false;
        }
      });

      if (!isAllowed) {
        logger.warn('redirect_uri not in client allowlist', { redirectUri, clientId });
        return defaultUri; // Fallback to default if not allowed
      }
    }
  }

  // Global allowlist check (optional - can be configured via env)
  const globalAllowlist = process.env.REDIRECT_URI_ALLOWLIST?.split(',').map((u) => u.trim()) || [];
  if (globalAllowlist.length > 0) {
    const isGloballyAllowed = globalAllowlist.some((allowedUri) => {
      try {
        const allowed = new URL(allowedUri);
        return (
          allowed.protocol === parsedUri.protocol &&
          allowed.hostname === parsedUri.hostname &&
          allowed.port === parsedUri.port
        );
      } catch {
        return false;
      }
    });

    if (!isGloballyAllowed) {
      logger.warn('redirect_uri not in global allowlist', { redirectUri });
      return defaultUri; // Fallback to default if not globally allowed
    }
  }

  return redirectUri;
}

/**
 * Redacts sensitive query parameters from logs
 */
function redactQueryParams(params: Record<string, string | undefined> | null | undefined): Record<string, string> {
  if (!params) return {};
  const redacted: Record<string, string> = {};
  const sensitiveKeys = ['launch_token', 'launchToken', 'session_token', 'sessionToken', 'token', 'secret'];
  
  for (const [key, value] of Object.entries(params)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = value || '';
    }
  }
  return redacted;
}

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
      logger.warn('Launch endpoint called without launch_token', {
        queryParams: redactQueryParams(params),
      });
      return errorResponse('Missing launch_token', 400, 'INVALID_REQUEST');
    }

    const result = await launchService.processLaunch(launchToken);

    if (!result) {
      logger.warn('Launch token verification failed', {
        queryParams: redactQueryParams(params),
      });
      return errorResponse('Invalid or expired launch token', 401, 'INVALID_LAUNCH_TOKEN');
    }

    const { userId, hmsId, clientId } = result;

    // Validate and sanitize redirect_uri
    const validatedRedirectUri = await validateRedirectUri(redirectUri, clientId, APP_BASE_URL);

    // Build redirect URL
    const redirectUrl = new URL(validatedRedirectUri);

    if (isLaunchResultWithCognito(result)) {
      // 6. Send Cognito tokens + doctor_uid to frontend via fragment (not sent to server, more secure)
      const fragment = new URLSearchParams();
      fragment.set('id_token', result.id_token);
      fragment.set('access_token', result.access_token);
      fragment.set('refresh_token', result.refresh_token);
      fragment.set('doctor_uid', result.doctor_uid);
      fragment.set('expires_in', String(result.expires_in));
      fragment.set('sso', 'true');
      if (state) fragment.set('state', state);
      redirectUrl.hash = fragment.toString();
      logger.info('SSO launch successful (Cognito tokens)', { doctor_uid: result.doctor_uid, hmsId, clientId });
    } else {
      // Legacy: session_token in query when Cognito not configured
      redirectUrl.searchParams.set('session_token', result.sessionToken);
      redirectUrl.searchParams.set('sso', 'true');
      if (state) redirectUrl.searchParams.set('state', state);
      logger.info('SSO launch successful (session token)', { userId, hmsId, clientId });
    }

    return {
      statusCode: 302,
      headers: {
        Location: redirectUrl.toString(),
        'Cache-Control': 'no-store, no-cache',
      },
      body: '',
    };
  } catch (error) {
    logger.error('Launch error', error as Error, {
      queryParams: redactQueryParams(event.queryStringParameters),
    });
    return errorResponse('Launch failed', 500, 'SERVER_ERROR');
  }
}
