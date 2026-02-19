/**
 * Token Service - JWT generation and validation for SSO sessions
 */
import { SessionTokenPayload, AuthorizedContext } from '../types';
export declare class TokenService {
    private secret;
    private expiresIn;
    constructor();
    generateSessionToken(payload: Omit<SessionTokenPayload, 'iat' | 'exp' | 'jti'>): string;
    validateSessionToken(token: string): SessionTokenPayload | null;
    extractContext(payload: SessionTokenPayload): AuthorizedContext;
}
