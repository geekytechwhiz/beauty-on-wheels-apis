/**
 * Launch Service - Verifies HMS launch tokens and creates JWT sessions
 *
 * Flow:
 * 1. HMS redirects user to /sso/launch?launch_token=JWT&redirect_uri=...
 * 2. We verify launch_token (JWT signed by HMS with shared launch_secret)
 * 3. Create session JWT
 * 4. Redirect user to app with session
 */
import { LaunchTokenPayload } from '../types';
export declare class LaunchService {
    private hmsClientService;
    private tokenService;
    constructor();
    /**
     * Verify launch token from HMS
     * Token must be signed with launch_secret from registered HMS client
     */
    verifyLaunchToken(launchToken: string): Promise<LaunchTokenPayload | null>;
    /**
     * Create JWT session from verified launch token payload
     */
    createSession(launchPayload: LaunchTokenPayload): string;
    /**
     * Full launch flow: verify token + create session
     */
    processLaunch(launchToken: string): Promise<{
        sessionToken: string;
        userId: string;
        hmsId: string;
    } | null>;
}
