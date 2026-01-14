import { UserRepository } from '../repositories/user.repository';
import { OrganizationRepository } from '../repositories/organization.repository';
import { createLogger, serializeError, createPerformanceTimer, createChildLogger } from '@api-hub/logger';
import { User, UserMetadata, UserOrganization, UserFile } from '../models';
import { UserNotFoundError, UserAlreadyExistsError } from '../utils/errors';
import { CognitoService } from './cognito.service';
import { publishEvent } from '../events/event.publisher';
import { randomUUID } from 'crypto';
import { ulid } from 'ulid';
import { notifyUser } from './notification.service';

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

      // Check if user already exists (must pass organizationId since getUser requires it)
      const existing = await this.repository.getUser(data.userID, organizationID);
      if (existing) {
        throw new UserAlreadyExistsError(data.userID);
      }

      // Normalize legacy aliases
      if (!data.emailAddress && (data as any).email) data.emailAddress = (data as any).email;
      if (!data.phoneNumber && (data as any).phone_number) data.phoneNumber = String((data as any).phone_number).trim();

      if (!data.firstName && !data.lastName && data.fullName) {
        const fullNameStr = String(data.fullName).trim();
        const regex = /^(\S+)\s+(.+)/;
        const match = fullNameStr.match(regex);
        if (match) {
          data.firstName = match[1];
          data.lastName = match[2];
        } else {
          data.firstName = fullNameStr;
          data.lastName = '';
        }
      } else if (data.firstName && !data.lastName) {
        data.lastName = '';
      }

      // Normalize phone number with + prefix
      const normalizePhone = (p: string, phoneCode?: string): string => {
        if (!p) return '';
        const s = String(p).trim();
        const code = String(phoneCode || '').trim();
        const composed = code ? `${code}${s}`.trim() : s;
        // If it already starts with +, leave as-is; otherwise prefix +
        return composed.startsWith('+') ? composed : `+${composed}`;
      };

      // Cognito integration via CognitoService: check email and phone one-by-one; if any exists in Cognito, throw error
      const normalizedEmail = data.emailAddress ? String(data.emailAddress).trim().toLowerCase() : '';
      const rawPhone = data.phoneNumber ? String(data.phoneNumber).trim() : '';
      const normalizedPhone = rawPhone ? normalizePhone(rawPhone, data.phoneCode) : '';
      
      // Store normalized phone but keep raw phone for DB (matching old implementation)
      const phoneNumberForDB = rawPhone || '';

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

      // Extract userRole early for use in Cognito and userCat calculation
      const userRoleArray = (data as any).userRole || [];
      
      let userCat: string[] = [];
      if (userTypeUpper === 'STAFF') {
        userCat = ['STAFF'];
      } else if (userTypeUpper === 'USER') {
        userCat = ['USER'];
      } else {
        // Default based on userType
        userCat = [userTypeUpper || 'USER'];
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

          const explicitUsername = (data as any).username && String((data as any).username).trim() !== '' 
            ? String((data as any).username).trim() 
            : null;
          const username = explicitUsername || normalizedEmail || normalizedPhone;
          
          const permissionIds: string[] = []; // Permissions would come from role service
          
          await cognitoService.createUser(
            username,
            {
              email: normalizedEmail || undefined,
              phoneNumber: normalizedPhone || undefined,
              customAttributes: {
                userType: String(data.userType || ''),
                userID: String(data.userID || ''),
                organizationID: String(organizationID || ''),
                role: JSON.stringify(userRoleArray),
                permissions: JSON.stringify(permissionIds),
              },
            }
          );
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

      const now = Date.now();
      
      // Generate code if not provided
      const code = (data as any).code || '';

      const devices = (data as any).devices;
      const isRpmUser = !!(devices && Array.isArray(devices) && devices.length > 0);
      
      const user: User = {
        ...data,
        phoneNumber: phoneNumberForDB,
        emailAddress: normalizedEmail || data.emailAddress || '',
        createdDate: data.createdDate ?? now,
        modifiedDate: data.modifiedDate ?? now,
        isActive: data.isActive ?? true,
        isLoggedIn: data.isLoggedIn ?? false,
        isRegisteredCompletely: data.isRegisteredCompletely ?? false,
        isRpmUser: data.isRpmUser ?? isRpmUser,
        isTaskCompleted: data.isTaskCompleted ?? false,
        changePassword: data.changePassword ?? true,
        logoutRequired: data.logoutRequired ?? false,
        itemType: data.userType ?? 'USER',
        invitedBy: invitedBy || data.invitedBy || '',
        srcRegisEntity: data.srcRegisEntity || (normalizedEmail ? 'email' : 'phone_number'),
        inviteCode: code ? `INVITE#${code}` : undefined,
        invitedID: code || undefined,
        tokenUpdatedAt: Math.floor(Date.now() / 1000), // Unix timestamp in seconds (matching old implementation)
        userCat: userCat,
      } as User;

      await this.repository.createUser(user);

      // Add user-organization mapping (future multi-org support)
      await this.repository.assignUserToOrganization(user);

      try {
        const userTypeUpper = String(user.userType || '').toUpperCase();
        const isStaff = userTypeUpper === 'STAFF';
        const template = isStaff ? 'WELCOME_STAFF' : 'WELCOME_USER';

        let notifyPhone: string | undefined = undefined;
        if (user.phoneNumber) {
          const pc = String(user.phoneCode || '').trim();
          const pn = String(user.phoneNumber || '').trim();
          if (pc) {
            notifyPhone = pc.startsWith('+') ? `${pc}${pn}` : `+${pc}${pn}`;
          } else {
            notifyPhone = pn;
          }
        }

        const deviceToken = (user as any).deviceToken || (user as any).device || undefined;

        const channels = [
          ...(user.emailAddress ? ['email'] : []),
          ...(notifyPhone ? ['sms'] : []),
          ...(deviceToken ? ['push'] : []),
        ];

        // Organization fields
        const orgAddress = orgDetails?.organizationAddress || orgDetails?.address || '';
        
        // Construct ORG_INFO matching old implementation logic
        // If adminDetails exists, use adminName + adminEmail, otherwise use orgEmail + orgPhone
        const adminInfo = orgDetails?.adminDetails;
        let orgInfo = '';
        if (adminInfo) {
          const adminName = (adminInfo as any)?.adminName || '';
          const adminEmail = (adminInfo as any)?.emailAddress || '';
          orgInfo = `${adminName}${adminName && adminEmail ? '<br>' : ''}${adminEmail}`;
        } else {
          const orgEmail = orgDetails?.emailAddress || '';
          const orgPhoneCode = orgDetails?.phoneCode || (orgDetails as any)?.phoneCode || '';
          const orgPhoneNumber = orgDetails?.phoneNumber || (orgDetails as any)?.phoneNumb || '';
          const orgPhone = orgPhoneCode && orgPhoneNumber ? `${orgPhoneCode}${orgPhoneNumber}` : (orgPhoneNumber || '');
          orgInfo = `${orgEmail}${orgEmail && orgPhone ? '<br>' : ''}${orgPhone}`;
        }

        // Base template data
        const baseTemplateData: Record<string, unknown> = {
          userType: user.userType,
          mrn: (user as any).mrn,
          ORG_NAME: orgDetails?.name || (orgDetails as any)?.organizationInfo?.organizationName || (orgDetails as any)?.organizationInfo?.name || '',
          ORG_INFO: orgInfo,
        };

        // Extend templateData based on user type (STAFF / USER / FNF)
        const templateData: Record<string, unknown> = { ...baseTemplateData };

        if (userTypeUpper === 'STAFF') {
          Object.assign(templateData, {
            STAFF_FIRST_NAME: user.firstName,
            PORTAL_LINK: process.env.PORTAL_LINK || '',
            ORG_ADDRESS: orgAddress,
          });
        } else if (userTypeUpper === 'FNF') {
          Object.assign(templateData, {
            WEB_DNS_URL: process.env.WEB_URL || process.env.WEB_DNS_URL || '',
            HOSPITAL_ID: orgDetails?.organizationID || '',
            TYPE: channels.includes('email') ? 'email' : channels.includes('sms') ? 'sms' : '',
            DEVICE: deviceToken ? '&rpm=true' : '',
            ORG_ADDRESS: orgAddress,
            FNF_FIRST_NAME: user.firstName,
            USER_NAME: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          });
        } else {
          // default USER and others
          Object.assign(templateData, {
            WEB_DNS_URL: process.env.WEB_URL || process.env.WEB_DNS_URL || '',
            HOSPITAL_ID: orgDetails?.organizationID || '',
            TYPE: channels.includes('email') ? 'email' : channels.includes('sms') ? 'sms' : '',
            DEVICE: deviceToken ? '&rpm=true' : '',
            ORG_ADDRESS: orgAddress,
            USER_FIRST_NAME: user.firstName,
          });
        }

        await notifyUser({
          userId: user.userID,
          email: user.emailAddress,
          phone: notifyPhone,
          name: user.fullName ?? user.firstName ?? '',
          deviceToken,
          channels,
          template,
          templateData,
          correlationId,
        });
      } catch (notifyErr) {
        logger.warn({ event: 'service_createUser_notification_failed', err: serializeError(notifyErr) });
      }

      logger.info({ event: 'service_createUser_success' });
      timer.end();
      return user;
    } catch (err) {
      logger.error({ event: 'service_createUser_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async getUser(userId: string, organizationId: string): Promise<User> {
    const timer = createPerformanceTimer(baseLogger, 'getUser');
    const logger = createChildLogger(baseLogger, { userId });
    logger.info({ event: 'service_getUser_start', userId, organizationId });

    try {
      const user = await this.repository.getUser(userId, organizationId);
      if (!user) {
        throw new UserNotFoundError(userId);
      }

      logger.info({ event: 'service_getUser_success', user });
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
    organizationId: string,
    updates: { email?: string; name?: string },
    correlationId?: string,
  ): Promise<User> {
    const timer = createPerformanceTimer(baseLogger, 'updateUser', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, userId });
    logger.info({ event: 'service_updateUser_start' });

    try {
      const existing = await this.repository.getUser(userId, organizationId);
      if (!existing) {
        throw new UserNotFoundError(userId);
      }

      await this.repository.updateUser(userId, updates);
      const updated = await this.repository.getUser(userId, organizationId);
      if (!updated) {
        throw new UserNotFoundError(userId);
      }


      // Best-effort notification that profile changed
      try {
        await notifyUser({
          userId: updated.userID,
          email: updates.email ?? updated.emailAddress,
          name: updates.name ?? updated.fullName ?? updated.firstName,
          channels: updates.email ? ['email'] : [],
          template: 'PROFILE_UPDATED',
          templateData: updates,
          correlationId,
        });
      } catch (notifyErr) {
        logger.warn({ event: 'service_updateUser_notification_failed', err: serializeError(notifyErr) });
      }

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
      const existing = await this.repository.getUser(userId, organizationId);
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

