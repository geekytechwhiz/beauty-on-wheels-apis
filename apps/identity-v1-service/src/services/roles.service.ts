import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

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
