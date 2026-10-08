import { LambdaRequest, BaseError } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";
import crypto from 'crypto';
import type { CognitoAuthClient } from '@api-hub/authentication-core';
import { getCognitoAuthClient } from '@api-hub/authentication-core';

import { prepareApplicationRolesForToken } from "../auth/application-role-assignment";
import {
    IdentityRepository,
    identityRepositoryInstance
} from "../repositories/identity.repository";
import { Session, User, InvalidRefreshTokenException } from "../types/repository.types";
import { LoginRequest, RefreshTokenRequest, ChangePasswordRequest } from "../schemas/authentication.schema";
import type { TokenResponse } from "../types/api-types";
import { hashPassword } from "./registration.service";
import { USER_STATUS } from "../constants/identity-index.constant";

const baseLogger = createLogger({
    service: "authentication-service",
    redactPII: true,
});

export function verifyPassword(password: string, storedHash: string): boolean {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, hash] = parts;
    const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
}

export function isActiveUser(status?: string): boolean {
    return (status ?? '').trim().toLowerCase() === USER_STATUS.ACTIVE;
}

export class AuthenticationService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "AuthenticationService"
            }
        );

    constructor(
        private readonly repository: IdentityRepository = identityRepositoryInstance,
        private readonly cognito: CognitoAuthClient = getCognitoAuthClient(),
    ) {}

    async postlogin(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "postlogin",
        });

        const body = request.body as LoginRequest;

        const user = await this.repository.getUserByEmail(body.username) ||
                     await this.repository.getUserByUsername(body.username);

        if (!user) {
            this.logger.info({ event: 'Login Failed', reason: 'User not found' });
            throw new BaseError("Invalid credentials", 401, "INVALID_CREDENTIALS");
        }

        const isPasswordValid = verifyPassword(body.password, user.passwordHash);
        if (!isPasswordValid) {
            await this.repository.saveLoginHistory({
                userId: user.userId,
                timestamp: new Date().toISOString(),
                status: 'FAILED',
                ipAddress: request.event?.requestContext?.identity?.sourceIp,
                userAgent: request.event?.headers?.['User-Agent'] || request.event?.headers?.['user-agent'],
            });

            this.logger.info({ event: 'Login Failed', reason: 'Invalid password', userId: user.userId });
            throw new BaseError("Invalid credentials", 401, "INVALID_CREDENTIALS");
        }

        return this.authenticateExistingIdentity(user, request);
    }

    async authenticateExistingIdentity(
        user: User,
        request?: LambdaRequest,
    ): Promise<TokenResponse> {
        if (!isActiveUser(user.status)) {
            this.logger.info({ event: 'Authentication Failed', reason: `Account status is ${user.status}`, userId: user.userId });
            throw new BaseError(`Account is ${user.status.toLowerCase()}`, 403, "ACCOUNT_NOT_ACTIVE");
        }

        const linked = await this.ensureCognitoLink(user);
        await this.prepareRoles(linked);
        const tokens = await this.cognito.issueTokens(linked.cognitoUsername as string);

        const sessionId = `s-${crypto.randomUUID()}`;
        const refreshTokenHash = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');

        const session: Session = {
            sessionId,
            userId: linked.userId,
            refreshTokenHash,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        };
        await this.repository.createSession(session);

        await this.repository.saveLoginHistory({
            userId: linked.userId,
            timestamp: new Date().toISOString(),
            status: 'SUCCESS',
            ipAddress: request?.event?.requestContext?.identity?.sourceIp,
            userAgent: request?.event?.headers?.['User-Agent'] || request?.event?.headers?.['user-agent'],
        });

        this.logger.info({ event: 'Authentication Successful', userId: linked.userId });

        return {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn,
            tokenType: tokens.tokenType || 'Bearer',
        };
    }

    async postrefreshtoken(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "postrefreshtoken",
        });

        const body = request.body as RefreshTokenRequest;
        const refreshTokenHash = crypto.createHash('sha256').update(body.refreshToken).digest('hex');

        const session = await this.repository.getRefreshToken(refreshTokenHash);
        if (!session) {
            throw new InvalidRefreshTokenException("Invalid refresh token");
        }

        if (session.status !== 'ACTIVE' && session.status !== 'active') {
            throw new InvalidRefreshTokenException("Refresh token expired or inactive");
        }
        if (new Date(session.expiresAt) < new Date()) {
            throw new InvalidRefreshTokenException("Refresh token expired or inactive");
        }

        const user = await this.repository.getUser(session.userId);
        if (!user || !isActiveUser(user.status)) {
            throw new BaseError("User not found or inactive", 401, "USER_INACTIVE");
        }

        await this.prepareRoles(user);
        const tokens = await this.cognito.refreshTokens(
          body.refreshToken,
          user.cognitoUsername,
        );

        return {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken || body.refreshToken,
            expiresIn: tokens.expiresIn,
            tokenType: tokens.tokenType || 'Bearer',
        };
    }

    async postlogout(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "postlogout",
        });

        const userId = request.context.userContext?.userId;
        const authHeader = request.context.authHeader;

        if (!userId || !authHeader) {
            throw new BaseError("Unauthorized", 401, "UNAUTHORIZED");
        }

        const user = await this.repository.getUser(userId);
        if (user?.cognitoUsername) {
            await this.cognito.signOut(user.cognitoUsername);
        }

        await this.repository.deleteAllSessions(userId);
        this.logger.info({ event: 'Logout Successful', userId });
    }

    async postchangepassword(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "postchangepassword",
        });

        const userId = request.context.userContext?.userId;
        if (!userId) {
            throw new BaseError("Unauthorized", 401, "UNAUTHORIZED");
        }

        const body = request.body as ChangePasswordRequest;

        const user = await this.repository.getUser(userId);
        if (!user) {
            throw new BaseError("User not found", 404, "USER_NOT_FOUND");
        }

        const isOldPasswordValid = verifyPassword(body.oldPassword, user.passwordHash);
        if (!isOldPasswordValid) {
            throw new BaseError("Invalid old password", 400, "INVALID_PASSWORD");
        }

        const newPasswordHash = hashPassword(body.newPassword);
        await this.repository.changePassword(userId, newPasswordHash, user.version);
        await this.repository.deleteAllSessions(userId);

        if (user.cognitoUsername) {
            await this.cognito.signOut(user.cognitoUsername);
        }

        this.logger.info({ event: 'Password Changed', userId });
    }

    /**
     * Persists the registration default CUSTOMER mapping, or an existing
     * VENDOR/ADMIN mapping, before Cognito issues a token. Login parameters are
     * not a role source. A write failure does not block sign-in; the pre-token
     * trigger then omits `roles` instead of inventing one.
     */
    private async prepareRoles(user: User): Promise<void> {
        try {
            await prepareApplicationRolesForToken(this.repository, user);
        } catch (err) {
            this.logger.warn({
                event: 'application_role_prepare_failed',
                userId: user.userId,
                error: err instanceof Error ? err.message : 'unknown',
            });
        }
    }

    /**
     * Ensures Cognito `sub` is persisted as IDENTITY#{sub}/LOOKUP.
     * In-memory identity fields are not sufficient — the authorizer resolves
     * application users only through that lookup item.
     */
    async ensureCognitoLink(
        user: User,
        knownIdentity?: { sub: string; username: string },
    ): Promise<User> {
        const identity =
            knownIdentity ??
            (user.identityId && user.cognitoUsername
                ? { sub: user.identityId, username: user.cognitoUsername }
                : await this.cognito.findOrCreateUser({
                      email: user.email?.trim() || undefined,
                      phoneNumber: user.phoneNumber?.trim() || undefined,
                  }));

        const existing = await this.repository.getUserByIdentityId(identity.sub);
        if (existing && existing.userId !== user.userId) {
            throw new BaseError(
                'Cognito identity is already linked to another user',
                409,
                'IDENTITY_ALREADY_LINKED',
            );
        }

        if (
            existing &&
            existing.userId === user.userId &&
            existing.cognitoUsername
        ) {
            return existing;
        }

        try {
            return await this.repository.linkIdentity(
                user.userId,
                identity.sub,
                identity.username,
            );
        } catch {
            const raced = await this.repository.getUserByIdentityId(identity.sub);
            if (raced && raced.userId === user.userId) {
                return raced;
            }
            throw new BaseError(
                'Cognito identity is already linked to another user',
                409,
                'IDENTITY_ALREADY_LINKED',
            );
        }
    }
}

let service: AuthenticationService;

export function getAuthenticationService() {
    if (!service) {
        service = new AuthenticationService();
    }
    return service;
}
