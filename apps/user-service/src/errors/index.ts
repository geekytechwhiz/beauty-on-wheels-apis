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
  UserNotFoundError,
  UserAlreadyExistsError,
  OrganizationNotFoundError,
  InvalidEventError,
  InviteUpdateTooSoonError,
} from './domain-errors';
