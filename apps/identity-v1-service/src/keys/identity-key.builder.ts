import { PREFIXES, SK_VALS } from '../constants/identity-index.constant';
import { normalizePhoneNumber } from '@api-hub/utils';

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

  static userProfile(userId: string) {
    return {
      PK: `${PREFIXES.USER}${userId.trim()}`,
      SK: SK_VALS.PROFILE,
    };
  }

  static userMeta(userId: string) {
    return {
      PK: `${PREFIXES.USER}${userId.trim()}`,
      SK: SK_VALS.META,
    };
  }

  static userByEmail(email: string) {
    return {
      PK: `${PREFIXES.EMAIL}${this.normalizeEmail(email)}`,
      SK: SK_VALS.LOOKUP,
    };
  }

  static userByPhone(phone: string) {
    return {
      PK: `${PREFIXES.PHONE}${this.normalizePhone(phone)}`,
      SK: SK_VALS.LOOKUP,
    };
  }

  static userByUsername(username: string) {
    return {
      PK: `${PREFIXES.USERNAME}${this.normalizeUsername(username)}`,
      SK: SK_VALS.LOOKUP,
    };
  }

  static userSession(userId: string, sessionId: string) {
    return {
      PK: `${PREFIXES.USER}${userId.trim()}`,
      SK: `${PREFIXES.SESSION}${sessionId.trim()}`,
    };
  }

  static refreshToken(userId: string, tokenId: string) {
    return {
      PK: `${PREFIXES.USER}${userId.trim()}`,
      SK: `${PREFIXES.REFRESH}${tokenId.trim()}`,
    };
  }

  static refreshTokenLookup(tokenHash: string) {
    return {
      PK: `${PREFIXES.REFRESH}${tokenHash.trim()}`,
      SK: SK_VALS.LOOKUP,
    };
  }

  static otp(userId: string, otpId: string) {
    return {
      PK: `${PREFIXES.USER}${userId.trim()}`,
      SK: `${PREFIXES.OTP}${otpId.trim()}${Math.random().toString(36).substring(2, 15)}`,
    };
  }

  static loginHistory(userId: string, timestamp: string) {
    return {
      PK: `${PREFIXES.USER}${userId.trim()}`,
      SK: `${PREFIXES.LOGIN_HISTORY}${timestamp.trim()}`,
    };
  }

  static passwordHistory(userId: string, timestamp: string) {
    return {
      PK: `${PREFIXES.USER}${userId.trim()}`,
      SK: `${PREFIXES.PASSWORD_HISTORY}${timestamp.trim()}`,
    };
  }

  static userRole(userId: string, roleId: string) {
    return {
      PK: `${PREFIXES.USER}${userId.trim()}`,
      SK: `${PREFIXES.ROLE}${roleId.trim()}`,
    };
  }

  static role(roleId: string) {
    return {
      PK: `${PREFIXES.ROLE}${roleId.trim()}`,
      SK: SK_VALS.METADATA,
    };
  }

  static permission(roleId: string, permissionId: string) {
    return {
      PK: `${PREFIXES.ROLE}${roleId.trim()}`,
      SK: `${PREFIXES.PERMISSION}${permissionId.trim()}`,
    };
  }

  static auditLog(auditId: string) {
    return {
      PK: `${PREFIXES.AUDIT}${auditId.trim()}`,
      SK: SK_VALS.METADATA,
    };
  }

  // GSI key generators
  static gsi1Pk(value: string): string {
    return value;
  }

  static gsi1Sk(value: string): string {
    return value;
  }

  static gsi2Pk(tenantId: string): string {
    return `TENANT#${tenantId.trim()}`;
  }

  static gsi2Sk(userId: string): string {
    return `${PREFIXES.USER}${userId.trim()}`;
  }
}
