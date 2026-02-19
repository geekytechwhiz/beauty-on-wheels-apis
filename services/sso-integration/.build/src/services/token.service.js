"use strict";
/**
 * Token Service - JWT generation and validation for SSO sessions
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
exports.TokenService = void 0;
const jwt = __importStar(require("jsonwebtoken"));
const logger_1 = require("../utils/logger");
const JWT_SECRET = process.env.JWT_SECRET || 'change-in-production';
const SESSION_EXPIRY = parseInt(process.env.SESSION_EXPIRY || '3600', 10);
class TokenService {
    constructor() {
        this.secret = JWT_SECRET;
        this.expiresIn = SESSION_EXPIRY;
    }
    generateSessionToken(payload) {
        const now = Math.floor(Date.now() / 1000);
        const jti = require('crypto').randomBytes(16).toString('hex');
        const tokenPayload = {
            ...payload,
            iat: now,
            exp: now + this.expiresIn,
            jti,
        };
        return jwt.sign(tokenPayload, this.secret, { algorithm: 'HS256' });
    }
    validateSessionToken(token) {
        try {
            const decoded = jwt.verify(token, this.secret);
            return decoded;
        }
        catch (error) {
            logger_1.logger.warn('Session token validation failed', { error: error.message });
            return null;
        }
    }
    extractContext(payload) {
        return {
            hmsId: payload.hmsId,
            clientId: payload.clientId,
            userId: payload.sub,
            scope: payload.scope || [],
            permissions: payload.scope || [],
        };
    }
}
exports.TokenService = TokenService;
//# sourceMappingURL=token.service.js.map