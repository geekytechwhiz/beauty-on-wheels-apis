import { BaseError, ForbiddenError, LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";
import { resolveApplicationRoles } from "@api-hub/authentication-core";

import {
    decideAdminRoleChange,
    grantAdminApplicationRole,
    revokeAdminApplicationRole,
} from "../auth/application-role-assignment";
import {
    RolesRepository,
    getRolesRepository
} from "../repositories/roles.repository";
import { Role } from "../types/repository.types";

const baseLogger = createLogger({
    service: "roles-service",
    redactPII: true,
});

export class RolesService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "RolesService"
            }
        );

    constructor(
        private readonly repository: RolesRepository = getRolesRepository()
    ) {}

    async getroles(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "getroles",
        });

        const roles = await this.repository.listRoles();
        return roles;
    }

    async assignAdminRole(request: LambdaRequest): Promise<{
        userId: string;
        roles: string[];
    }> {
        const userId = request.params?.userId?.trim() ?? '';
        const requestedRole =
            typeof (request.body as { role?: unknown } | undefined)?.role === 'string'
                ? (request.body as { role: string }).role
                : '';
        const decision = decideAdminRoleChange({
            callerRoles: request.context.authContext?.roles,
            requestedRole,
        });
        if (!decision.ok) {
            if (decision.reason === 'forbidden') {
                throw new ForbiddenError('Administrator access is required');
            }
            throw new BaseError(
                'Only ADMIN can be assigned through this operation',
                400,
                'ROLE_NOT_ASSIGNABLE',
            );
        }

        this.logger.info({ event: 'admin_role_assigned', userId });
        await grantAdminApplicationRole(this.repository, userId);
        const roles = resolveApplicationRoles(
            await this.repository.getUserRoles(userId),
        );
        return { userId, roles };
    }

    async revokeAdminRole(request: LambdaRequest): Promise<{
        userId: string;
        roles: string[];
    }> {
        const userId = request.params?.userId?.trim() ?? '';
        const requestedRole = request.params?.role?.trim() ?? '';
        const decision = decideAdminRoleChange({
            callerRoles: request.context.authContext?.roles,
            requestedRole,
        });
        if (!decision.ok) {
            if (decision.reason === 'forbidden') {
                throw new ForbiddenError('Administrator access is required');
            }
            throw new BaseError(
                'Only ADMIN can be removed through this operation',
                400,
                'ROLE_NOT_ASSIGNABLE',
            );
        }

        this.logger.info({ event: 'admin_role_revoked', userId });
        await revokeAdminApplicationRole(this.repository, userId);
        const roles = resolveApplicationRoles(
            await this.repository.getUserRoles(userId),
        );
        return { userId, roles };
    }

    async assignRole(userId: string, roleId: string): Promise<void> {
        this.logger.info({ event: 'Role Assigned', userId, roleId });
        await this.repository.assignRole(userId, roleId);
    }

    async removeRole(userId: string, roleId: string): Promise<void> {
        this.logger.info({ event: 'Role Removed', userId, roleId });
        await this.repository.removeRole(userId, roleId);
    }

    async getUserRoles(userId: string): Promise<string[]> {
        return this.repository.getUserRoles(userId);
    }

    async listRoles(): Promise<Role[]> {
        return this.repository.listRoles();
    }
}

let service: RolesService;

export function getRolesService() {
    if (!service) {
        service = new RolesService();
    }
    return service;
}
