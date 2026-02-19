/**
 * Type definitions for MyVitalRx SSO - HMS Launch Flow
 */
export interface HMSClient {
    clientId: string;
    clientSecret: string;
    launchSecret: string;
    hmsId: string;
    hmsName: string;
    allowedScopes: string[];
    redirectUris?: string[];
    appBaseUrl?: string;
    createdAt: string;
    active: boolean;
}
export interface LaunchTokenPayload {
    sub: string;
    hmsId: string;
    clientId: string;
    email?: string;
    name?: string;
    roles?: string[];
    permissions?: string[];
    iat: number;
    exp: number;
}
export interface SessionTokenPayload {
    sub: string;
    hmsId: string;
    clientId: string;
    sessionId: string;
    email?: string;
    name?: string;
    scope: string[];
    iss: string;
    aud: string;
    iat: number;
    exp: number;
    jti: string;
}
export interface AuthorizedContext {
    hmsId: string;
    clientId: string;
    userId: string;
    scope: string[];
    permissions: string[];
}
