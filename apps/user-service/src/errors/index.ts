/**
 * Central export for domain and HTTP-aware errors.
 * Use: import { UserNotFoundError, ValidationError } from '../errors';
 */

export { 
  NotFoundError,
  ConflictError,
  ValidationError,
  DownstreamServiceError,
  UserNotFoundError,
  UserAlreadyExistsError,
  OrganizationNotFoundError,
  InvalidEventError,
  InviteUpdateTooSoonError,
} from './user-errors';
