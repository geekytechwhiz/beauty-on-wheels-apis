import { isConditionalWriteConflictAtIndex } from '@api-hub/utils';

export const TRANSACT_INDEX_USER_META = 0;
export const TRANSACT_INDEX_EMAIL_LOOKUP = 1;
export const TRANSACT_INDEX_PHONE_LOOKUP = 2;
export const TRANSACT_INDEX_USERNAME_LOOKUP = 3;
export const TRANSACT_INDEX_PROFILE = 4;

export const TRANSACT_INDEX_SESSION = 0;
export const TRANSACT_INDEX_REFRESH_LOOKUP = 1;

export function isUserMetaConditionalFailure(err: unknown): boolean {
  return isConditionalWriteConflictAtIndex(err, TRANSACT_INDEX_USER_META);
}

export function isEmailLookupConditionalFailure(err: unknown): boolean {
  return isConditionalWriteConflictAtIndex(err, TRANSACT_INDEX_EMAIL_LOOKUP);
}

export function isPhoneLookupConditionalFailure(err: unknown): boolean {
  return isConditionalWriteConflictAtIndex(err, TRANSACT_INDEX_PHONE_LOOKUP);
}

export function isUsernameLookupConditionalFailure(err: unknown): boolean {
  return isConditionalWriteConflictAtIndex(err, TRANSACT_INDEX_USERNAME_LOOKUP);
}

export function isProfileConditionalFailure(err: unknown): boolean {
  return isConditionalWriteConflictAtIndex(err, TRANSACT_INDEX_PROFILE);
}
