"use strict";
/**
 * Launch Service - Verifies HMS launch tokens and creates JWT sessions
 *
 * Flow:
 * 1. HMS redirects user to /sso/launch?launch_token=JWT&redirect_uri=...
 * 2. We verify launch_token (JWT signed by HMS with shared launch_secret)
 * 3. Create session JWT
 * 4. Redirect user to app with session
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LaunchService = void 0;
const jwt = __importStar(require("jsonwebtoken"));
const hms_client_service_1 = require("./hms-client.service");
const token_service_1 = require("./token.service");
const logger_1 = require("../utils/logger");
const LAUNCH_TOKEN_MAX_AGE = 5 * 60; // 5 minutes
class LaunchService {
    constructor() {
        this.hmsClientService = new hms_client_service_1.HMSClientService();
        this.tokenService = new token_service_1.TokenService();
    }
    /**
     * Verify launch token from HMS
     * Token must be signed with launch_secret from registered HMS client
     */
    async verifyLaunchToken(launchToken) {
        try {
            // Decode without verify first to get clientId for secret lookup
            const decoded = jwt.decode(launchToken);
            if (!decoded) {
                logger_1.logger.warn('Launch token invalid or malformed');
                return null;
            }
            // Support clientId, client_id, or aud (common JWT conventions)
            const clientId = decoded.clientId ||
                decoded.client_id ||
                decoded.aud;
            if (!clientId) {
                logger_1.logger.warn('Launch token missing clientId (expected clientId, client_id, or aud)', {
                    payloadKeys: Object.keys(decoded),
                });
                return null;
            }
            const hmsClient = await this.hmsClientService.getClient(clientId);
            if (!hmsClient || !hmsClient.active) {
                logger_1.logger.warn('HMS client not found or inactive', { clientId: decoded.clientId });
                return null;
            }
            const verified = jwt.verify(launchToken, hmsClient.launchSecret, {
                algorithms: ['HS256'],
                maxAge: LAUNCH_TOKEN_MAX_AGE,
            });
            // Normalize to LaunchTokenPayload
            return {
                sub: verified.sub,
                hmsId: (verified.hmsId || verified.hms_id),
                clientId,
                email: verified.email,
                name: verified.name,
                roles: verified.roles,
                permissions: verified.permissions,
                iat: verified.iat,
                exp: verified.exp,
            };
        }
        catch (error) {
            logger_1.logger.warn('Launch token verification failed', { error: error.message });
            return null;
        }
    }
    /**
     * Create JWT session from verified launch token payload
     */
    createSession(launchPayload) {
        const sessionId = require('crypto').randomBytes(16).toString('hex');
        const scope = launchPayload.permissions || launchPayload.roles || ['user:read'];
        const payload = {
            sub: launchPayload.sub,
            hmsId: launchPayload.hmsId,
            clientId: launchPayload.clientId,
            sessionId,
            email: launchPayload.email,
            name: launchPayload.name,
            scope,
            iss: process.env.APP_ISSUER || 'myvitalrx-sso',
            aud: 'myvitalrx-app',
        };
        const sessionToken = this.tokenService.generateSessionToken(payload);
        logger_1.logger.info('Session created', {
            userId: launchPayload.sub,
            hmsId: launchPayload.hmsId,
            clientId: launchPayload.clientId,
        });
        return sessionToken;
    }
    /**
     * Full launch flow: verify token + create session
     */
    async processLaunch(launchToken) {
        const payload = await this.verifyLaunchToken(launchToken);
        if (!payload)
            return null;
        const sessionToken = this.createSession(payload);
        return {
            sessionToken,
            userId: payload.sub,
            hmsId: payload.hmsId,
        };
    }
}
exports.LaunchService = LaunchService;
//# sourceMappingURL=launch.service.js.map