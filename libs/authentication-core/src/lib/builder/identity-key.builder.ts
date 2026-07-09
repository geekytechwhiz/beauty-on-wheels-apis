import { normalizePhoneNumber } from '@api-hub/utils';

import {
  LOOKUP_SK,
  OTP_REF_GSI_PREFIX,
  OTP_SK_PREFIX,
  REFRESH_GSI_PREFIX,
  SESSION_SK_PREFIX,
  STATUS_GSI_PREFIX,
  USER_META_SK,
  USER_PROFILE_SK,
} from '../constants/identity.constants';

const USER_PREFIX = 'USER#';
const EMAIL_PREFIX = 'EMAIL#';
const PHONE_PREFIX = 'PHONE#';
const USERNAME_PREFIX = 'USERNAME#';
const REFRESH_PREFIX = 'REFRESH#';

function padEpochMs13(epochMs: number): string {
  return String(epochMs).padStart(13, '0');
}

export class IdentityKeyBuilder {
  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  static normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  static normalizePhone(phoneNumber: string): string {
    const details = normalizePhoneNumber(phoneNumber);
    if (details.isValid && details.e164) {
      return details.e164;
    }
    return phoneNumber.trim().replace(/\s+/g, '');
  }

  static toUserPk(userId: string): string {
    return `${USER_PREFIX}${userId.trim()}`;
  }

  static toUserMetaSk(): string {
    return USER_META_SK;
  }

  static toUserProfileSk(): string {
    return USER_PROFILE_SK;
  }

  static toEmailLookupPk(email: string): string {
    return `${EMAIL_PREFIX}${this.normalizeEmail(email)}`;
  }

  static toPhoneLookupPk(phoneNumber: string): string {
    return `${PHONE_PREFIX}${this.normalizePhone(phoneNumber)}`;
  }

  static toUsernameLookupPk(username: string): string {
    return `${USERNAME_PREFIX}${this.normalizeUsername(username)}`;
  }

  static toLookupSk(): string {
    return LOOKUP_SK;
  }

  static toSessionSk(sessionId: string): string {
    return `${SESSION_SK_PREFIX}${sessionId.trim()}`;
  }

  static toOtpSk(purpose: string): string {
    return `${OTP_SK_PREFIX}${purpose.trim()}`;
  }

  static toRefreshLookupPk(tokenHash: string): string {
    return `${REFRESH_PREFIX}${tokenHash.trim()}`;
  }

  static toRefreshLookupSk(): string {
    return LOOKUP_SK;
  }

  static buildGsi2Pk(tokenHash: string): string {
    return `${REFRESH_GSI_PREFIX}${tokenHash.trim()}`;
  }

  static buildGsi2Sk(userId: string, sessionId: string): string {
    return `${USER_PREFIX}${userId.trim()}#${SESSION_SK_PREFIX}${sessionId.trim()}`;
  }

  static buildGsi3Pk(referenceId: string): string {
    return `${OTP_REF_GSI_PREFIX}${referenceId.trim()}`;
  }

  static buildGsi3Sk(userId: string, purpose: string): string {
    return `${USER_PREFIX}${userId.trim()}#${OTP_SK_PREFIX}${purpose.trim()}`;
  }

  static buildGsi4Pk(status: string): string {
    return `${STATUS_GSI_PREFIX}${status}`;
  }

  static buildGsi4Sk(createdAtIso: string, userId: string): string {
    const epochMs = Date.parse(createdAtIso);
    const padded = Number.isFinite(epochMs)
      ? padEpochMs13(epochMs)
      : padEpochMs13(0);
    return `${padded}#${userId.trim()}`;
  }
}
