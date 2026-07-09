import { BaseError } from '@api-hub/utils';

export class UserNotFoundError extends BaseError {
  constructor(userId: string) {
    super(`User not found: ${userId}`, 404, 'USER_NOT_FOUND', undefined, {
      metadata: { userId },
    });
    this.name = 'UserNotFoundError';
  }
}

export class DuplicateEmailError extends BaseError {
  constructor(email: string) {
    super(`Email already registered: ${email}`, 409, 'DUPLICATE_EMAIL', undefined, {
      metadata: { email },
    });
    this.name = 'DuplicateEmailError';
  }
}

export class DuplicatePhoneError extends BaseError {
  constructor(phoneNumber: string) {
    super(`Phone number already registered`, 409, 'DUPLICATE_PHONE', undefined, {
      metadata: { phoneNumber },
    });
    this.name = 'DuplicatePhoneError';
  }
}

export class DuplicateUsernameError extends BaseError {
  constructor(username: string) {
    super(`Username already taken: ${username}`, 409, 'DUPLICATE_USERNAME', undefined, {
      metadata: { username },
    });
    this.name = 'DuplicateUsernameError';
  }
}

export class SessionNotFoundError extends BaseError {
  constructor(userId: string, sessionId: string) {
    super(`Session not found`, 404, 'SESSION_NOT_FOUND', undefined, {
      metadata: { userId, sessionId },
    });
    this.name = 'SessionNotFoundError';
  }
}

export class OtpNotFoundError extends BaseError {
  constructor(userId: string, purpose: string) {
    super(`OTP not found`, 404, 'OTP_NOT_FOUND', undefined, {
      metadata: { userId, purpose },
    });
    this.name = 'OtpNotFoundError';
  }
}

export class OptimisticLockConflictError extends BaseError {
  constructor(entity: string, id: string) {
    super(`Optimistic lock conflict on ${entity}`, 409, 'OPTIMISTIC_LOCK_CONFLICT', undefined, {
      metadata: { entity, id },
    });
    this.name = 'OptimisticLockConflictError';
  }
}
