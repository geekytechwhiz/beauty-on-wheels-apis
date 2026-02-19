"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const launch_service_1 = require("../../services/launch.service");
const logger_1 = require("../../utils/logger");
const response_1 = require("../../utils/response");
const launchService = new launch_service_1.LaunchService();
const APP_BASE_URL = process.env.APP_BASE_URL || process.env.MYVITALRX_APP_URL || 'https://app.myvitalrx.com';
async function handler(event, _context) {
    try {
        const params = event.queryStringParameters || {};
        const launchToken = params.launch_token || params.launchToken;
        const redirectUri = params.redirect_uri || params.redirectUri;
        const state = params.state || '';
        if (!launchToken) {
            logger_1.logger.warn('Launch endpoint called without launch_token');
            return (0, response_1.errorResponse)('Missing launch_token', 400, 'INVALID_REQUEST');
        }
        const result = await launchService.processLaunch(launchToken);
        if (!result) {
            logger_1.logger.warn('Launch token verification failed');
            return (0, response_1.errorResponse)('Invalid or expired launch token', 401, 'INVALID_LAUNCH_TOKEN');
        }
        const { sessionToken, userId, hmsId } = result;
        // Build redirect URL
        const baseUrl = redirectUri || APP_BASE_URL;
        const redirectUrl = new URL(baseUrl);
        // Pass session via fragment (recommended - not sent to server) or query
        // Using query for compatibility with all clients; consider fragment for SPAs
        redirectUrl.searchParams.set('session_token', sessionToken);
        redirectUrl.searchParams.set('sso', 'true');
        if (state)
            redirectUrl.searchParams.set('state', state);
        logger_1.logger.info('SSO launch successful', { userId, hmsId });
        return {
            statusCode: 302,
            headers: {
                Location: redirectUrl.toString(),
                'Cache-Control': 'no-store, no-cache',
            },
            body: '',
        };
    }
    catch (error) {
        logger_1.logger.error('Launch error', error, { queryParams: event.queryStringParameters });
        return (0, response_1.errorResponse)('Launch failed', 500, 'SERVER_ERROR');
    }
}
//# sourceMappingURL=launch.js.map