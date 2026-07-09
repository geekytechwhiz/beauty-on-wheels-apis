import { AuthenticationRepository } from '../repositories/AuthenticationRepository';
import { BaseService } from './BaseServices';
import type {
  OtpDdbRecord,
  SessionDdbRecord,
} from '../persistence/identity-ddb.model';
import type {
  CreateSessionRepoInput,
  FindActiveSessionsOptions,
  FindActiveSessionsPageResult,
  SaveOtpRepoInput,
  SaveRefreshTokenRepoInput,
} from '../persistence/identity-repository.types';

export class AuthenticationService extends BaseService<AuthenticationRepository> {
  constructor(repo?: AuthenticationRepository) {
    super(repo ?? new AuthenticationRepository());
  }

  async createSession(
    input: CreateSessionRepoInput,
  ): Promise<SessionDdbRecord> {
    return this.repo.createSession(input);
  }

  async findSession(
    userId: string,
    sessionId: string,
  ): Promise<SessionDdbRecord | null> {
    return this.repo.findSession(userId, sessionId);
  }

  async findActiveSessions(
    userId: string,
    options?: FindActiveSessionsOptions,
  ): Promise<FindActiveSessionsPageResult> {
    return this.repo.findActiveSessions(userId, options);
  }

  async findSessionByRefreshToken(
    tokenHash: string,
  ): Promise<SessionDdbRecord | null> {
    return this.repo.findSessionByRefreshToken(tokenHash);
  }

  async revokeSession(
    userId: string,
    sessionId: string,
  ): Promise<SessionDdbRecord> {
    return this.repo.revokeSession(userId, sessionId);
  }

  async revokeAllSessions(userId: string): Promise<number> {
    return this.repo.revokeAllSessions(userId);
  }

  async deleteExpiredSessions(
    userId: string,
    beforeIso?: string,
  ): Promise<number> {
    return this.repo.deleteExpiredSessions(userId, beforeIso);
  }

  async saveOtp(input: SaveOtpRepoInput): Promise<OtpDdbRecord> {
    return this.repo.saveOtp(input);
  }

  async findOtp(userId: string, purpose: string): Promise<OtpDdbRecord | null> {
    return this.repo.findOtp(userId, purpose);
  }

  async findOtpByReferenceId(
    referenceId: string,
  ): Promise<OtpDdbRecord | null> {
    return this.repo.findOtpByReferenceId(referenceId);
  }

  async deleteOtp(userId: string, purpose: string): Promise<void> {
    return this.repo.deleteOtp(userId, purpose);
  }

  async incrementOtpAttempts(
    userId: string,
    purpose: string,
    maxAttempts: number,
  ): Promise<OtpDdbRecord> {
    return this.repo.incrementOtpAttempts(userId, purpose, maxAttempts);
  }

  async markOtpVerified(
    userId: string,
    purpose: string,
  ): Promise<OtpDdbRecord> {
    return this.repo.markOtpVerified(userId, purpose);
  }

  async saveRefreshToken(input: SaveRefreshTokenRepoInput): Promise<void> {
    return this.repo.saveRefreshToken(input);
  }

  async deleteRefreshToken(tokenHash: string): Promise<void> {
    return this.repo.deleteRefreshToken(tokenHash);
  }
}
