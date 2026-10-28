import { ForbiddenError, LambdaRequest } from '@api-hub/utils';

export interface VisitActor {
  userId: string;
  role: 'owner' | 'staff' | 'admin';
  staffId?: string;
  communityIds: string[];
  serviceAreaIds: string[];
  staffIds: string[];
  /** False when the vendor staff directory could not be read. */
  staffDirectory: boolean;
}

export interface VisitAccess {
  resolve(request: LambdaRequest, vendorId: string): Promise<VisitActor>;
}

const ADMIN_ROLES = new Set([
  'admin',
  'super_admin',
  'superadmin',
  'platform_admin',
  'platformadmin',
  'admin_staff',
  'catalog_admin',
]);

const OWNER_ROLES = new Set([
  'vendor',
  'vendor_owner',
  'vendorowner',
  'provider',
  'partner',
  'owner',
]);

/**
 * Vendor membership is not checked for service visits right now.
 * The authenticated user is treated as the owner unless the token says they are staff.
 */
export class HttpVisitAccess implements VisitAccess {
  async resolve(request: LambdaRequest, _vendorId: string): Promise<VisitActor> {
    const roles = callerRoles(request);
    const userId = callerUserId(request);
    if (roles.some((role) => ADMIN_ROLES.has(role))) {
      return {
        userId,
        role: 'admin',
        communityIds: [],
        serviceAreaIds: [],
        staffIds: [],
        staffDirectory: true,
      };
    }
    const role = roles.includes('staff') && !roles.some((item) => OWNER_ROLES.has(item))
      ? 'staff'
      : 'owner';
    return {
      userId,
      role,
      staffId: callerStaffId(request),
      communityIds: [],
      serviceAreaIds: [],
      staffIds: [],
      staffDirectory: true,
    };
  }
}

function callerRoles(request: LambdaRequest): string[] {
  const bags = [request.context.authContext?.roles, request.context.userContext?.roles];
  return bags.flatMap((value) => {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    return typeof value === 'string' ? [value] : [];
  }).map((role) => role.trim().toLowerCase().replace(/[\s-]+/g, '_'));
}

function callerUserId(request: LambdaRequest): string {
  const userId = request.context.authContext?.userId ?? request.context.userContext?.userId;
  if (!userId?.trim()) {
    throw new ForbiddenError('Authenticated user id is required');
  }
  return userId.trim();
}

function callerStaffId(request: LambdaRequest): string | undefined {
  const claims = request.context.authContext?.claims;
  const staffId = claims && typeof claims.staffId === 'string' ? claims.staffId : undefined;
  return staffId?.trim() ? staffId.trim() : undefined;
}
