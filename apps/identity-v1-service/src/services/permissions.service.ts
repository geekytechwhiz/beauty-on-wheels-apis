import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    PermissionsRepository,
    getPermissionsRepository
} from "../repositories/permissions.repository";
import { Permission } from "../types/repository.types";

const baseLogger = createLogger({
    service: "permissions-service",
    redactPII: true,
});

export class PermissionsService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "PermissionsService"
            }
        );

    constructor(
        private readonly repository: PermissionsRepository = getPermissionsRepository()
    ) {}

    async getpermissions(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "getpermissions",
        });

        let roleId = request.params?.roleId;

        // If no roleId is explicitly passed, resolve it from the current authenticated user's role
        if (!roleId) {
            const userId = request.context.userContext?.userId;
            if (userId) {
                const user = await this.repository.getUser(userId);
                if (user && user.roleId) {
                    roleId = user.roleId;
                }
            }
        }

        const permissions = roleId ? await this.repository.listPermissions(roleId) : [];
        return permissions;
    }

    async getPermissions(roleId: string): Promise<Permission[]> {
        return this.repository.listPermissions(roleId);
    }

    async hasPermission(roleId: string, permissionId: string): Promise<boolean> {
        return this.repository.hasPermission(roleId, permissionId);
    }
}

let service: PermissionsService;

export function getPermissionsService() {
    if (!service) {
        service = new PermissionsService();
    }
    return service;
}
