import { UserRepository } from '../repositories/UserRepository';
import { BaseService } from './BaseServices';
import type {
  UserMetaDdbRecord,
  UserProfileDdbRecord,
} from '../persistence/identity-ddb.model';
import type {
  CreateUserRepoInput,
  SaveProfileRepoInput,
  UpdateProfileRepoInput,
  UpdateUserRepoInput,
} from '../persistence/identity-repository.types';

export class UserService extends BaseService<UserRepository> {
  constructor(repo?: UserRepository) {
    super(repo ?? new UserRepository());
  }

  async createUser(input: CreateUserRepoInput): Promise<UserMetaDdbRecord> {
    return this.repo.createUser(input);
  }

  async updateUser(input: UpdateUserRepoInput): Promise<UserMetaDdbRecord> {
    return this.repo.updateUser(input);
  }

  async deleteUser(userId: string): Promise<void> {
    return this.repo.deleteUser(userId);
  }

  async findByUserId(userId: string): Promise<UserMetaDdbRecord | null> {
    return this.repo.findByUserId(userId);
  }

  async findByEmail(email: string): Promise<UserMetaDdbRecord | null> {
    return this.repo.findByEmail(email);
  }

  async findByPhone(phoneNumber: string): Promise<UserMetaDdbRecord | null> {
    return this.repo.findByPhone(phoneNumber);
  }

  async findByUsername(username: string): Promise<UserMetaDdbRecord | null> {
    return this.repo.findByUsername(username);
  }

  async existsByEmail(email: string): Promise<boolean> {
    return this.repo.existsByEmail(email);
  }

  async existsByPhone(phoneNumber: string): Promise<boolean> {
    return this.repo.existsByPhone(phoneNumber);
  }

  async existsByUsername(username: string): Promise<boolean> {
    return this.repo.existsByUsername(username);
  }

  async activateUser(userId: string): Promise<UserMetaDdbRecord> {
    return this.repo.activateUser(userId);
  }

  async deactivateUser(userId: string): Promise<UserMetaDdbRecord> {
    return this.repo.deactivateUser(userId);
  }

  async suspendUser(userId: string): Promise<UserMetaDdbRecord> {
    return this.repo.suspendUser(userId);
  }

  async updatePassword(
    userId: string,
    passwordHash: string,
    expectedVersion: number,
  ): Promise<UserMetaDdbRecord> {
    return this.repo.updatePassword(userId, passwordHash, expectedVersion);
  }

  async verifyEmail(userId: string): Promise<UserMetaDdbRecord> {
    return this.repo.verifyEmail(userId);
  }

  async verifyPhone(userId: string): Promise<UserMetaDdbRecord> {
    return this.repo.verifyPhone(userId);
  }

  async assignRole(
    userId: string,
    roleId: string,
    expectedVersion: number,
  ): Promise<UserMetaDdbRecord> {
    return this.repo.assignRole(userId, roleId, expectedVersion);
  }

  async removeRole(
    userId: string,
    expectedVersion: number,
  ): Promise<UserMetaDdbRecord> {
    return this.repo.removeRole(userId, expectedVersion);
  }

  async updateProfile(
    input: UpdateProfileRepoInput,
  ): Promise<UserProfileDdbRecord | null> {
    return this.repo.updateProfile(input);
  }

  async findProfile(userId: string): Promise<UserProfileDdbRecord | null> {
    return this.repo.findProfile(userId);
  }

  async saveProfile(
    input: SaveProfileRepoInput,
  ): Promise<UserProfileDdbRecord> {
    return this.repo.saveProfile(input);
  }
}
