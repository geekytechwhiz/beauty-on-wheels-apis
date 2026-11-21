import {
  APPLICATION_ROLE,
  isPlatformAdminRole,
  resolveApplicationRoles,
} from './application-roles';

export interface RegistrationAccessInput {
  roles: readonly string[];
  /** Ignored. Kept so call sites can pass authorizer context unchanged. */
  permissions?: readonly string[];
}

/**
 * REGISTRANT/GUEST without an operating vendor role or a platform admin role.
 * Role names are matched exactly. A userType value is not a role.
 */
export function isRegistrationOnlyAccess(
  input: RegistrationAccessInput,
): boolean {
  const application = resolveApplicationRoles(input.roles);
  const broader =
    application.includes(APPLICATION_ROLE.VENDOR) ||
    isPlatformAdminRole(application);
  const registrationOnly =
    application.includes(APPLICATION_ROLE.REGISTRANT) ||
    application.includes(APPLICATION_ROLE.GUEST);
  return registrationOnly && !broader;
}

/**
 * @deprecated Role-only auth: REGISTRANT/GUEST is enough for registration.
 * Always returns true when the caller has a registration role.
 */
export function hasResolvedRegisterPermission(
  _permissions: readonly string[],
): boolean {
  return true;
}
