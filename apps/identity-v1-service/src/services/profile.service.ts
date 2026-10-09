import { LambdaRequest, BaseError } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    ProfileRepository,
    getProfileRepository
} from "../repositories/profile.repository";
import { MeResponse, Profile } from "../types/repository.types";

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
    ): Promise<MeResponse> {
        this.logger.info({
            event: "getme",
        });

        const userId = request.context.userContext?.userId;
        if (!userId) {
            throw new BaseError("Unauthorized", 401, "UNAUTHORIZED");
        }

        const [profile, user] = await Promise.all([
            this.repository.getProfile(userId),
            this.repository.getUser(userId),
        ]);

        if (!user && !profile) {
            throw new BaseError("User not found", 404, "USER_NOT_FOUND");
        }

        // Never expose passwordHash; merge META + PROFILE (profile wins on overlap).
        const safeUser = user
            ? (({ passwordHash: _passwordHash, ...rest }) => rest)(user)
            : { userId };

        return {
            ...safeUser,
            ...(profile ?? {}),
            userId,
            firstName: profile?.firstName ?? '',
            lastName: profile?.lastName ?? '',
            // Legacy identities predate userType and remain customers.
            userType: user?.userType ?? 'CUSTOMER',
        };
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
