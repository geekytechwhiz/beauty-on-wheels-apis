import { LambdaRequest } from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';
import { APPLICATION_ROLE } from '@api-hub/authentication-core';
import crypto from 'crypto';

import { prepareApplicationRolesForToken } from '../auth/application-role-assignment';
import {
  IdentityRepository,
  identityRepositoryInstance,
} from '../repositories/identity.repository';
import { User, Profile, UserAlreadyExistsException } from '../types/repository.types';
import { RegisterRequest } from '../schemas/registration.schema';

const baseLogger = createLogger({
  service: 'registration-service',
  redactPII: true,
});

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export type CreateIdentityInput = {
  email?: string;
  phoneNumber?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  identityId?: string;
  cognitoUsername?: string;
};

export class RegistrationService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'RegistrationService',
  });

  constructor(
    private readonly repository: IdentityRepository = identityRepositoryInstance,
  ) {}

  async register(request: LambdaRequest) {
    this.logger.info({
      event: 'register',
    });

    const body = request.body as RegisterRequest;
    const email = body.email;
    const username = body.email; // Defaulting username to email
    const phone = body.phone;

    // Check email uniqueness
    const existingEmail = await this.repository.getUserByEmail(email);
    if (existingEmail) {
      throw new UserAlreadyExistsException(`User with email ${email} already exists`);
    }

    // Check username uniqueness
    const existingUsername = await this.repository.getUserByUsername(username);
    if (existingUsername) {
      throw new UserAlreadyExistsException(`User with username ${username} already exists`);
    }

    // Check phone uniqueness
    if (phone) {
      const existingPhone = await this.repository.getUserByPhone(phone);
      if (existingPhone) {
        throw new UserAlreadyExistsException(`User with phone ${phone} already exists`);
      }
    }

    const newUser = await this.createIdentity({
      email,
      phoneNumber: phone,
      password: body.password,
      firstName: body.firstName,
      lastName: body.lastName,
    });

    this.logger.info({
      event: 'User Registered',
      userId: newUser.userId,
      email: newUser.email,
    });

    // TODO: Publish UserRegistered event
    // eventBus.publish(new UserRegisteredEvent(newUser));

    return {
      id: newUser.userId,
      email: newUser.email,
      phone: newUser.phoneNumber,
      status: newUser.status,
      roles: [APPLICATION_ROLE.CUSTOMER],
    };
  }

  /**
   * Shared identity persistence used by email/password registration and OTP verify.
   * User.email, User.username, and User.passwordHash are required by the existing
   * model, so OTP-created identities store empty email/phone when absent, use the
   * verified destination as username, and persist an unusable random password hash
   * (not a known password) so password login cannot succeed.
   */
  async createIdentity(input: CreateIdentityInput): Promise<User> {
    const email = input.email?.trim() ?? '';
    const phoneNumber = input.phoneNumber?.trim() ?? '';
    const username = email || phoneNumber;
    const userId = `u-${crypto.randomUUID()}`;
    const passwordHash = input.password
      ? hashPassword(input.password)
      : hashPassword(crypto.randomBytes(32).toString('hex'));

    const newUser: User = {
      userId,
      email,
      username,
      phoneNumber,
      passwordHash,
      status: 'ACTIVE',
      emailVerified: Boolean(input.emailVerified),
      phoneVerified: Boolean(input.phoneVerified),
      version: 1,
      roleId: 'user',
      identityId: input.identityId,
      cognitoUsername: input.cognitoUsername,
    };

    const newProfile: Profile = {
      userId,
      firstName: input.firstName ?? '',
      lastName: input.lastName ?? '',
    };

    await this.repository.createUser(newUser, newProfile);
    await prepareApplicationRolesForToken(this.repository, newUser);
    return newUser;
  }

  async postregister(request: LambdaRequest) {
    return this.register(request);
  }
}

let service: RegistrationService;

export function getRegistrationService() {
  if (!service) {
    service = new RegistrationService();
  }
  return service;
}
