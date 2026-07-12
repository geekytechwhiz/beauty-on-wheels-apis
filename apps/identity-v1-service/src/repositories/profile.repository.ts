import {
    IdentityRepository
} from "./identity.repository";

import {
    env
} from "../configs/env.config";
import { Profile } from '../types/repository.types';
import { IdentityKeyBuilder } from '../keys/identity-key.builder';
import { IdentityMapper } from '../mappers/identity.mapper';
import { ProfileDdbItem } from '../models/dynamodb-item';

export class ProfileRepository
    extends IdentityRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

    async getProfile(userId: string): Promise<Profile | null> {
        const keys = IdentityKeyBuilder.userProfile(userId);
        const item = await this.get<ProfileDdbItem>(this.getTableName(), keys);
        return item ? IdentityMapper.toProfileDomain(item) : null;
    }

    async updateProfile(profile: Profile): Promise<Profile> {
        const profileDdb = IdentityMapper.toProfileDdb(profile);
        await this.put(this.getTableName(), profileDdb);
        return profile;
    }

    async deleteProfile(userId: string): Promise<void> {
        const keys = IdentityKeyBuilder.userProfile(userId);
        await this.delete(this.getTableName(), keys);
    }

}

let repository:
    ProfileRepository;

export function getProfileRepository() {

    if (!repository) {

        repository =
            new ProfileRepository();

    }

    return repository;

}
