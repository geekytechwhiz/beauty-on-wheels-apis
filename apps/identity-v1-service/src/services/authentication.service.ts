import { LambdaRequest, BaseError } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import {
    IdentityRepository,
    identityRepositoryInstance
} from "../repositories/identity.repository";
import { Session, InvalidRefreshTokenException } from "../types/repository.types";
import { LoginRequest, RefreshTokenRequest, ChangePasswordRequest } from "../schemas/authentication.schema";
import { hashPassword } from "./registration.service";

const baseLogger = createLogger({
    service: "authentication-service",
    redactPII: true,
});

const JWT_SECRET = process.env.JWT_SECRET || 'beauty-on-wheels-jwt-secret-key-123';

export function verifyPassword(password: string, storedHash: string): boolean {
    if (password === storedHash) return true;
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, hash] = parts;
    const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
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
        private readonly repository: IdentityRepository = identityRepositoryInstance
    ) {}

    async postlogin(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "postlogin",
        });

        const body = request.body as LoginRequest;

        // Find user by email or username
        const user = await this.repository.getUserByEmail(body.username) || 
                     await this.repository.getUserByUsername(body.username);

        if (!user) {
            this.logger.info({ event: 'Login Failed', reason: 'User not found', username: body.username });
            throw new BaseError("Invalid credentials", 401, "INVALID_CREDENTIALS");
        }

        // Verify password securely
        const isPasswordValid = verifyPassword(body.password, user.passwordHash);
        if (!isPasswordValid) {
            // Save login history as failed
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

        // Validate account status
        if (user.status !== 'ACTIVE') {
            this.logger.info({ event: 'Login Failed', reason: `Account status is ${user.status}`, userId: user.userId });
            throw new BaseError(`Account is ${user.status.toLowerCase()}`, 403, "ACCOUNT_NOT_ACTIVE");
        }

        const sessionId = `s-${crypto.randomUUID()}`;

        // Generate JWT and Refresh Token
        const tokenPayload = {
            sub: user.userId,
            userId: user.userId,
            sessionId,
            roleId: user.roleId,
            email: user.email,
        };
        const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '15m' });
        
        const refreshToken = crypto.randomBytes(32).toString('hex');
        const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

        // Create Session
        const session: Session = {
            sessionId,
            userId: user.userId,
            refreshTokenHash,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        };
        await this.repository.createSession(session);

        // Save login history
        await this.repository.saveLoginHistory({
            userId: user.userId,
            timestamp: new Date().toISOString(),
            status: 'SUCCESS',
            ipAddress: request.event?.requestContext?.identity?.sourceIp,
            userAgent: request.event?.headers?.['User-Agent'] || request.event?.headers?.['user-agent'],
        });

        this.logger.info({ event: 'Login Successful', userId: user.userId });

        // TODO: Publish UserLoggedIn event
        // eventBus.publish(new UserLoggedInEvent(user));

        return {
            accessToken,
            refreshToken,
            expiresIn: 15 * 60,
            tokenType: 'Bearer',
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

        if (session.status !== 'ACTIVE' || new Date(session.expiresAt) < new Date()) {
            throw new InvalidRefreshTokenException("Refresh token expired or inactive");
        }

        const user = await this.repository.getUser(session.userId);
        if (!user || user.status !== 'ACTIVE') {
            throw new BaseError("User not found or inactive", 401, "USER_INACTIVE");
        }

        const tokenPayload = {
            sub: user.userId,
            userId: user.userId,
            sessionId: session.sessionId,
            roleId: user.roleId,
            email: user.email,
        };
        const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '15m' });

        return {
            accessToken,
            refreshToken: body.refreshToken,
            expiresIn: 15 * 60,
            tokenType: 'Bearer',
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

        const decoded = jwt.decode(authHeader.replace(/^\s*Bearer\s+/i, '').trim()) as Record<string, any>;
        const sessionId = decoded?.sessionId;

        if (sessionId) {
            const session = await this.repository.getSession(userId, sessionId);
            if (session) {
                await this.repository.deleteSession(userId, sessionId);
                await this.repository.deleteRefreshToken(session.refreshTokenHash);
                this.logger.info({ event: 'Logout Successful', userId, sessionId });
            }
        }
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

        this.logger.info({ event: 'Password Changed', userId });

        // TODO: Publish PasswordChanged event
        // eventBus.publish(new PasswordChangedEvent(userId));
    }
}

let service: AuthenticationService;

export function getAuthenticationService() {
    if (!service) {
        service = new AuthenticationService();
    }
    return service;
}
