/**
 * Central export for domain and HTTP-aware errors.
 * Use: import { UserNotFoundError, ValidationError } from '../errors';
 */

export {
  DomainError,
  NotFoundError,
  ConflictError,
  ValidationError,
  DownstreamServiceError,
  // User
  UserNotFoundError,
  UserAlreadyExistsError,
  InviteUpdateTooSoonError,
  // Organisation
  OrganizationNotFoundError,
  OrganizationNotExistError,
  OrganizationOnHoldError,
  OrganizationMismatchError,
  // Friend & Family
  EmailOrPhoneRequiredError,
  FnfLimitReachedError,
  UserAlreadyInvitedError,
  UserAlreadyInvitedBySomeoneError,
  UserAlreadyAddedAsFnfError,
  MemberNotFoundError,
  FnfDoesNotExistError,
  // Misc
  InvalidEventError,
} from './domain-errors';
