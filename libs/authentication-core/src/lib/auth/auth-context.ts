export interface AuthContext {
  identityId: string;
  userId?: string;
  roles: string[];
  permissions: string[];
  claims: Record<string, unknown>;
}

export interface AuthUser {
  /**
   * Identity subject that owns role mappings. Callers receive
   * {@link applicationUserId} when a User Service link exists.
   */
  userId: string;
  /** Verified User Service id. Absent for legacy identities with no provisioning record. */
  applicationUserId?: string;
  identityId?: string;
  roleId?: string;
  status?: string;
}

/**
 * Application directory used to resolve Cognito identity → user → roles → permissions.
 * Services implement this against their identity store. JWT validation does not require it.
 */
export interface AuthUserDirectory {
  findUserByIdentityId(identityId: string): Promise<AuthUser | null>;
  getUserRoles(userId: string): Promise<string[]>;
  getPermissionsForRoles(roleIds: string[]): Promise<string[]>;
}

export interface AuthenticateOptions {
  userDirectory?: AuthUserDirectory;
  /**
   * When true (default if a directory is provided), a verified Cognito identity
   * with no application user mapping is rejected.
   */
  requireApplicationUser?: boolean;
  /** When set, JWT `token_use` must match. Omit to accept both access and id tokens. */
  expectedTokenUse?: 'access' | 'id';
}

export interface AuthorizeOptions {
  permissions: string[];
  /** When true, the caller must have every listed permission (default). */
  requireAll?: boolean;
}
