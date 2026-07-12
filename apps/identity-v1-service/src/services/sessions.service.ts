import { LambdaRequest, BaseError } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    SessionsRepository,
    getSessionsRepository
} from "../repositories/sessions.repository";
import { Session, SessionNotFoundException } from "../types/repository.types";

const baseLogger = createLogger({
    service: "sessions-service",
    redactPII: true,
});

export class SessionsService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "SessionsService"
            }
        );

    constructor(
        private readonly repository: SessionsRepository = getSessionsRepository()
    ) {}

    async getsessions(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "getsessions",
        });

        const userId = request.context.userContext?.userId;
        if (!userId) {
            throw new BaseError("Unauthorized", 401, "UNAUTHORIZED");
        }

        const sessions = await this.repository.listSessions(userId);
        return sessions;
    }

    async deletesessions(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "deletesessions",
        });

        const userId = request.context.userContext?.userId;
        if (!userId) {
            throw new BaseError("Unauthorized", 401, "UNAUTHORIZED");
        }

        const sessions = await this.repository.listSessions(userId);
        await this.repository.deleteAllSessions(userId);

        // Delete all corresponding refresh token lookups
        for (const session of sessions) {
            await this.repository.deleteRefreshToken(session.refreshTokenHash);
        }
    }

    async deletesessionid(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "deletesessionid",
        });

        const userId = request.context.userContext?.userId;
        if (!userId) {
            throw new BaseError("Unauthorized", 401, "UNAUTHORIZED");
        }

        const sessionId = request.params?.sessionId;
        if (!sessionId) {
            throw new BaseError("Session ID is required", 400, "SESSION_ID_REQUIRED");
        }

        const session = await this.repository.getSession(userId, sessionId);
        if (!session) {
            throw new SessionNotFoundException("Session not found");
        }

        await this.repository.deleteSession(userId, sessionId);
        await this.repository.deleteRefreshToken(session.refreshTokenHash);
    }

    async getSession(userId: string, sessionId: string): Promise<Session | null> {
        return this.repository.getSession(userId, sessionId);
    }

    async listSessions(userId: string): Promise<Session[]> {
        return this.repository.listSessions(userId);
    }

    async deleteSession(userId: string, sessionId: string): Promise<void> {
        const session = await this.repository.getSession(userId, sessionId);
        if (session) {
            await this.repository.deleteSession(userId, sessionId);
            await this.repository.deleteRefreshToken(session.refreshTokenHash);
        }
    }

    async deleteAllSessions(userId: string): Promise<void> {
        const sessions = await this.repository.listSessions(userId);
        await this.repository.deleteAllSessions(userId);
        for (const session of sessions) {
            await this.repository.deleteRefreshToken(session.refreshTokenHash);
        }
    }
}

let service: SessionsService;

export function getSessionsService() {
    if (!service) {
        service = new SessionsService();
    }
    return service;
}
