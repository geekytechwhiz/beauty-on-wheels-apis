import { UserRepository } from '../repositories/user.repository';
import { OrganizationRepository } from '../repositories/organization.repository';
import { createLogger, serializeError, createPerformanceTimer, createChildLogger } from '@api-hub/logger';
import { User, UserMetadata, UserOrganization, UserFile } from '../models';
import { UserNotFoundError, UserAlreadyExistsError } from '../utils/errors';
import { CognitoService } from './cognito.service';
import { publishEvent } from '../events/event.publisher';
import { randomUUID } from 'crypto';
import { ulid } from 'ulid';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
function generateSortableId() {
  const now = Date.now();
  const timePart = now.toString(36).toUpperCase().padStart(6, '0');
  const randomPart = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
  return `${timePart}${randomPart}`;
}

function generateMRN() {
  return `PI-${generateSortableId()}`;
}

export class UserService {
  private repository: UserRepository;
  private organizationRepository: OrganizationRepository;

  constructor() {
    this.repository = new UserRepository();
    this.organizationRepository = new OrganizationRepository();
  }

  async createUser(data: Partial<User>, organizationID?: string, invitedBy?: string, correlationId?: string): Promise<User> {
    const timer = createPerformanceTimer(baseLogger, 'createUser', correlationId);
    // Generate ULID if userID is not provided
    if (!data.userID) {
      data.userID = data.code || ulid();
    }
    const logger = createChildLogger(baseLogger, { correlationId, userId: data.userID, organizationID, invitedBy });
    logger.info({ event: 'service_createUser_start' });

    try {
      if (!organizationID) throw new Error('organizationID is required');
      data.organizationID = organizationID;
      const orgDetails = await this.organizationRepository.getOrganization(data?.organizationID || '');
      if (!orgDetails) {
        throw new Error('Organization does not exist');
      }
      if (orgDetails.status && ['on_hold', 'disabled', 'not_exist'].includes(String(orgDetails.status).toLowerCase())) {
        throw new Error('Organization is not available');
      }

      // Check if user already exists
      const existing = await this.repository.getUser(data.userID);
      if (existing) {
        throw new UserAlreadyExistsError(data.userID);
      }

      // Normalize legacy aliases
      if (!data.emailAddress && (data as any).email) data.emailAddress = (data as any).email;
      if (!data.phoneNumber && (data as any).phone_number) data.phoneNumber = String((data as any).phone_number).trim();

      // Cognito integration via CognitoService: check email and phone one-by-one; if any exists in Cognito, throw error
      const normalizedEmail = data.emailAddress ? String(data.emailAddress).trim().toLowerCase() : '';
      const normalizedPhone = data.phoneNumber ? String((data.phoneCode || '') + data.phoneNumber).replace(/\s+/g, '') : '';

      const userTypeUpper = String(data.userType || '').toUpperCase();

      // STAFF: email required
      if (userTypeUpper === 'STAFF' && !normalizedEmail) {
        throw new Error('STAFF must have an email address');
      }

      // USER / FNF must have at least one identifier
      if ((userTypeUpper === 'USER' || userTypeUpper === 'FNF') && !normalizedEmail && !normalizedPhone) {
        throw new Error('Either email or phone number is required for USER/FNF');
      }

      // If user is a patient (USER) ensure MRN exists (generate if missing)
      if ((userTypeUpper === 'USER' || String(data.itemType || '').toUpperCase() === 'USER') && !(data as any).mrn) {
        (data as any).mrn = generateMRN();
      }

      if (normalizedEmail || normalizedPhone) {
        try {
          const cognitoService = new CognitoService(
            process.env.DEFAULT_AWS_REGION || 'us-east-1',
            process.env.COGNITO_USER_POOL_ID || ''
          );

          if (normalizedEmail) {
            const existsEmail = await cognitoService.userExistsIdentifier(normalizedEmail);
            if (existsEmail) {
              throw new UserAlreadyExistsError(normalizedEmail);
            }
          }

          if (normalizedPhone) {
            const existsPhone = await cognitoService.userExistsIdentifier(normalizedPhone);
            if (existsPhone) {
              throw new UserAlreadyExistsError(normalizedPhone);
            }
          }

          // Create user in Cognito with attributes (prefer email as username)
          const username = normalizedEmail || normalizedPhone;
          await cognitoService.createUser(username, { email: normalizedEmail || undefined, phoneNumber: normalizedPhone || undefined });
          logger.info({ event: 'service_createUser_cognito_success', email: normalizedEmail, phone: normalizedPhone, username });
        } catch (err) {
          if (err instanceof UserAlreadyExistsError) {
            logger.error({ event: 'service_createUser_cognito_error', email: normalizedEmail, phone: normalizedPhone, err: serializeError(err) });
            throw err;
          }

          logger.error({
            event: 'service_createUser_cognito_error',
            email: normalizedEmail,
            phone: normalizedPhone,
            err: serializeError(err),
            message: 'Failed to create user in Cognito',
          });
        }
      }

      // Build user object with correct PK/SK and all fields
      const now = Date.now();
      const user: User = {
        ...data,
        createdDate: data.createdDate ?? now,
        modifiedDate: data.modifiedDate ?? now,
        isActive: data.isActive ?? true,
        isLoggedIn: data.isLoggedIn ?? false,
        isRegisteredCompletely: data.isRegisteredCompletely ?? false,
        isRpmUser: data.isRpmUser ?? false,
        isTaskCompleted: data.isTaskCompleted ?? false,
        changePassword: data.changePassword ?? true,
        logoutRequired: data.logoutRequired ?? false,
        itemType: data.itemType ?? 'USER',
      } as User;

      await this.repository.createUser(user);

      // Add user-organization mapping (future multi-org support)
      await this.repository.assignUserToOrganization(user);

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'UserCreated',
          occurredAt: new Date().toISOString(),
          source: 'user-service',
          correlationId,
          data: {
            userId: user.userID,
            email: user.emailAddress,
            name: user.fullName ?? user.firstName ?? '',
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_createUser_success' });
      timer.end();
      return user;
    } catch (err) {
      logger.error({ event: 'service_createUser_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async getUser(userId: string): Promise<User> {
    const timer = createPerformanceTimer(baseLogger, 'getUser');
    const logger = createChildLogger(baseLogger, { userId });
    logger.info({ event: 'service_getUser_start' });

    try {
      const user = await this.repository.getUser(userId);
      if (!user) {
        throw new UserNotFoundError(userId);
      }

      logger.info({ event: 'service_getUser_success' });
      timer.end();
      return user;
    } catch (err) {
      logger.error({ event: 'service_getUser_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async updateUser(
    userId: string,
    updates: { email?: string; name?: string },
    correlationId?: string,
  ): Promise<User> {
    const timer = createPerformanceTimer(baseLogger, 'updateUser', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, userId });
    logger.info({ event: 'service_updateUser_start' });

    try {
      const existing = await this.repository.getUser(userId);
      if (!existing) {
        throw new UserNotFoundError(userId);
      }

      await this.repository.updateUser(userId, updates);
      const updated = await this.repository.getUser(userId);
      if (!updated) {
        throw new UserNotFoundError(userId);
      }

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'UserProfileUpdated.v1',
          occurredAt: new Date().toISOString(),
          source: 'user-service',
          correlationId,
          data: {
            userId: updated.userID,
            email: updates.email,
            name: updates.name,
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_updateUser_success' });
      timer.end();
      return updated;
    } catch (err) {
      logger.error({ event: 'service_updateUser_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async deleteUser(userId: string, correlationId?: string): Promise<void> {
    const timer = createPerformanceTimer(baseLogger, 'deleteUser', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, userId });
    logger.info({ event: 'service_deleteUser_start' });

    try {
      const existing = await this.repository.getUser(userId);
      if (!existing) {
        throw new UserNotFoundError(userId);
      }

      await this.repository.deleteUser(userId);

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'UserDeleted.v1',
          occurredAt: new Date().toISOString(),
          source: 'user-service',
          correlationId,
          data: {
            userId,
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_deleteUser_success' });
      timer.end();
    } catch (err) {
      logger.error({ event: 'service_deleteUser_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async assignUserToOrganization(userId: string, organizationId: string): Promise<void> {
    const timer = createPerformanceTimer(baseLogger, 'assignUserToOrganization');
    const logger = createChildLogger(baseLogger, { userId, organizationId });
    logger.info({ event: 'service_assignUserToOrg_start' });

    try {
      const existing = await this.repository.getUser(userId);
      if (!existing) {
        throw new UserNotFoundError(userId);
      }

      await this.repository.assignUserToOrganization(existing);
      logger.info({ event: 'service_assignUserToOrg_success' });
      timer.end();
    } catch (err) {
      logger.error({ event: 'service_assignUserToOrg_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async listUserOrganizations(userId: string): Promise<UserOrganization[]> {
    const timer = createPerformanceTimer(baseLogger, 'listUserOrganizations');
    const logger = createChildLogger(baseLogger, { userId });
    logger.info({ event: 'service_listUserOrgs_start' });

    try {
      const existing = await this.repository.getUser(userId);
      if (!existing) {
        throw new UserNotFoundError(userId);
      }

      const orgs = await this.repository.listUserOrganizations(userId);
      logger.info({ event: 'service_listUserOrgs_success', count: orgs.length });
      timer.end();
      return orgs;
    } catch (err) {
      logger.error({ event: 'service_listUserOrgs_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async updateUserMetadata(userId: string, metadata: Record<string, unknown>): Promise<UserMetadata> {
    const timer = createPerformanceTimer(baseLogger, 'updateUserMetadata');
    const logger = createChildLogger(baseLogger, { userId });
    logger.info({ event: 'service_updateUserMetadata_start' });

    try {
      const existing = await this.repository.getUser(userId);
      if (!existing) {
        throw new UserNotFoundError(userId);
      }

      await this.repository.updateUserMetadata(userId, metadata);
      const updated = await this.repository.getUserMetadata(userId);
      if (!updated) {
        throw new UserNotFoundError(userId);
      }

      logger.info({ event: 'service_updateUserMetadata_success' });
      timer.end();
      return updated;
    } catch (err) {
      logger.error({ event: 'service_updateUserMetadata_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async listUserFiles(userId: string): Promise<UserFile[]> {
    const timer = createPerformanceTimer(baseLogger, 'listUserFiles');
    const logger = createChildLogger(baseLogger, { userId });
    logger.info({ event: 'service_listUserFiles_start' });

    try {
      const existing = await this.repository.getUser(userId);
      if (!existing) {
        throw new UserNotFoundError(userId);
      }

      const files = await this.repository.listUserFiles(userId);
      logger.info({ event: 'service_listUserFiles_success', count: files.length });
      timer.end();
      return files;
    } catch (err) {
      logger.error({ event: 'service_listUserFiles_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async createUserFile(
    userId: string,
    fileId: string,
    fileName: string,
    s3Key: string,
    correlationId?: string,
  ): Promise<UserFile> {
    const timer = createPerformanceTimer(baseLogger, 'createUserFile', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, userId, fileId });
    logger.info({ event: 'service_createUserFile_start' });

    try {
      const existing = await this.repository.getUser(userId);
      if (!existing) {
        throw new UserNotFoundError(userId);
      }

      const now = new Date().toISOString();
      const userFile: UserFile = {
        userId,
        fileId,
        fileName,
        s3Key,
        uploadedAt: now,
      };

      await this.repository.createUserFile(userFile);

      await publishEvent(
        {
          eventId: randomUUID(),
          eventType: 'UserFileUploaded.v1',
          occurredAt: now,
          source: 'user-service',
          correlationId,
          data: {
            userId,
            fileId,
            fileName,
            s3Key,
          },
        },
        correlationId,
      );

      logger.info({ event: 'service_createUserFile_success' });
      timer.end();
      return userFile;
    } catch (err) {
      logger.error({ event: 'service_createUserFile_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }
}

