import { LambdaRequest } from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';
import crypto from 'crypto';

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

    // Hash password securely with native PBKDF2
    const passwordHash = hashPassword(body.password);
    const userId = `u-${crypto.randomUUID()}`;

    const newUser: User = {
      userId,
      email,
      username,
      phoneNumber: phone || '',
      passwordHash,
      status: 'ACTIVE',
      emailVerified: false,
      phoneVerified: false,
      version: 1,
      roleId: 'user', // Default role
    };

    const newProfile: Profile = {
      userId,
      firstName: body.firstName,
      lastName: body.lastName,
    };

    await this.repository.createUser(newUser, newProfile);

    this.logger.info({
      event: 'User Registered',
      userId,
      email,
    });

    // TODO: Publish UserRegistered event
    // eventBus.publish(new UserRegisteredEvent(newUser));

    return {
      id: userId,
      email: newUser.email,
      phone: newUser.phoneNumber,
      status: newUser.status,
      roles: newUser.roleId ? [newUser.roleId] : [],
    };
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
