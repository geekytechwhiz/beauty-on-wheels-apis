import { LambdaRequest, BaseError } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    ProfileRepository,
    getProfileRepository
} from "../repositories/profile.repository";
import { Profile } from "../types/repository.types";

const baseLogger = createLogger({
    service: "profile-service",
    redactPII: true,
});

export class ProfileService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "ProfileService"
            }
        );

    constructor(
        private readonly repository: ProfileRepository = getProfileRepository()
    ) {}

    async getme(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "getme",
        });

        const userId = request.context.userContext?.userId;
        if (!userId) {
            throw new BaseError("Unauthorized", 401, "UNAUTHORIZED");
        }

        const profile = await this.repository.getProfile(userId);
        if (!profile) {
            const user = await this.repository.getUser(userId);
            if (!user) {
                throw new BaseError("User not found", 404, "USER_NOT_FOUND");
            }
            // If profile is missing but user exists, return default details
            return {
                userId,
                firstName: "",
                lastName: "",
            };
        }

        return profile;
    }

    async getProfile(userId: string): Promise<Profile | null> {
        return this.repository.getProfile(userId);
    }

    async updateProfile(profile: Profile): Promise<Profile> {
        return this.repository.updateProfile(profile);
    }

    async deleteProfile(userId: string): Promise<void> {
        return this.repository.deleteProfile(userId);
    }
}

let service: ProfileService;

export function getProfileService() {
    if (!service) {
        service = new ProfileService();
    }
    return service;
}
