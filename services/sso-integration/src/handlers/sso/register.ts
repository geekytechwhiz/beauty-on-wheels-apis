/**
 * HMS Registration Endpoint
 * Register HMS to get client credentials and launch_secret for SSO
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { HMSClientService } from '../../services/hms-client.service';
import { logger } from '../../utils/logger';
import { successResponse, errorResponse } from '../../utils/response';

const crypto = require('crypto');
const hmsClientService = new HMSClientService();

function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function handler(
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const hmsId = body.hmsId || body.hms_id;
    const hmsName = body.hmsName || body.hms_name || hmsId;
    const allowedScopes = body.allowedScopes || body.allowed_scopes || [
      'patients:read', 'patients:write', 'prescriptions:read', 'prescriptions:write',
    ];
    const redirectUris = body.redirectUris || body.redirect_uris || [];
    const appBaseUrl = body.appBaseUrl || body.app_base_url || '';

    if (!hmsId) {
      return errorResponse('Missing hmsId', 400, 'INVALID_REQUEST');
    }

    const clientId = generateId();
    const clientSecret = generateSecret();
    const launchSecret = generateSecret();

    const client = await hmsClientService.registerClient({
      clientId,
      clientSecret,
      launchSecret,
      hmsId,
      hmsName,
      allowedScopes: Array.isArray(allowedScopes) ? allowedScopes : [allowedScopes],
      redirectUris: Array.isArray(redirectUris) ? redirectUris : redirectUris ? [redirectUris] : [],
      appBaseUrl: appBaseUrl || undefined,
    });

    logger.info('HMS client registered', { hmsId, clientId });

    const baseUrl = process.env.API_BASE_URL || process.env.SERVICE_URL || 'https://api.myvitalrx.com';
    const launchUrl = `${baseUrl.replace(/\/$/, '')}/sso/launch`;

    return successResponse({
      client_id: clientId,
      client_secret: clientSecret,
      launch_secret: launchSecret,
      hms_id: hmsId,
      hms_name: hmsName,
      launch_url: launchUrl,
      allowed_scopes: client.allowedScopes,
      message: 'Store client_secret and launch_secret securely. They cannot be retrieved again.',
    });
  } catch (error) {
    logger.error('Registration error', error as Error);
    return errorResponse('Registration failed', 500, 'SERVER_ERROR');
  }
}
