import { UserRepository, ListOrganizationUsersOptions } from '../repositories/user.repository';
import { OrganizationRepository } from '../repositories/organization.repository';
import { createLogger, serializeError, createPerformanceTimer, createChildLogger } from '@api-hub/logger';
import { User, UserMetadata, UserOrganization, UserFile } from '../models';
import { UserNotFoundError, UserAlreadyExistsError } from '../utils/errors';
import { CognitoService } from './cognito.service';
import { publishEvent } from '../events/event.publisher';
import { randomUUID } from 'crypto';
import { ulid } from 'ulid';
import { notifyUser } from './notification.service';
import { FriendFamilyRepository } from '../repositories/friendFamily.repository';
import { UserLinkRepository } from '../repositories/userLink.repository';
import { getRoleDetails } from './role.service';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const friendFamilyRepository = new FriendFamilyRepository();
const userLinkRepository = new UserLinkRepository();
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

  async createUser(
    data: Partial<User>,
    organizationID?: string,
    invitedBy?: string,
    correlationId?: string,
    authHeader?: string,
    friendNFamily?: Record<string, unknown>,
    assignDoctor?: Record<string, unknown>,
  ): Promise<User> {
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
      const orgDetails = await this.organizationRepository.getOrganization(
        data?.organizationID || '',
        authHeader,
      );
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

      if (friendNFamily && Object.keys(friendNFamily).length > 0 && organizationID) {
        const fullNameRaw = String((friendNFamily as any).name || '').trim();
        const nameMatch = fullNameRaw.match(/^(\S+)\s+(.+)/);
        const fnfFirstName = nameMatch ? nameMatch[1] : fullNameRaw;
        const fnfLastName = nameMatch ? nameMatch[2] : '';
        const fnfEmail = String((friendNFamily as any).email || '').trim();
        const fnfPhoneCode = String((friendNFamily as any).phoneCode || '').trim();
        const fnfPhone = String((friendNFamily as any).phone || '').trim();
        const fullPhoneNumber = fnfPhoneCode ? `${fnfPhoneCode}${fnfPhone}` : fnfPhone;
        const friendNFamilyFullName = `${fnfFirstName}${fnfLastName ? ` ${fnfLastName}` : ''}`.trim();
        const definedRoleCode = String((user as any).definedRoleCode || '').toUpperCase();
        const fnfRole = definedRoleCode === 'FRIEND' || definedRoleCode === 'FAMILY' ? definedRoleCode : 'FAMILY';
        try {
          const searchResult = await friendFamilyRepository.searchFnf({
            body: {
              email: fnfEmail,
              phone: fullPhoneNumber,
              firstName: fnfFirstName,
              lastName: fnfLastName,
              roles: [fnfRole],
            },
            userID: user.userID,
            organizationID,
          });
          const memberId = searchResult?.invitedUser;
          if (searchResult?.success && memberId) {
            await friendFamilyRepository.addFriendFamily({
              body: {
                memberId,
                userId: user.userID,
                userName: user.fullName ?? user.firstName ?? '',
                memberName: friendNFamilyFullName,
              },
              organizationID,
            });
            logger.info({ event: 'service_createUser_friend_family_linked', memberId, userId: user.userID });
          } else if (searchResult) {
            logger.warn({ event: 'service_createUser_friend_family_not_found', result: searchResult });
          }
        } catch (err) {
          logger.warn({ event: 'service_createUser_friend_family_failed', err: serializeError(err) });
        }
      }

      if (assignDoctor && Object.keys(assignDoctor).length > 0 && organizationID) {
        const doctorId =
          (assignDoctor as any).doctorId ||
          (assignDoctor as any).doctorID ||
          (assignDoctor as any).userId ||
          (assignDoctor as any).userID;
        if (doctorId) {
          try {
            const doctor = await this.repository.getUser(doctorId, organizationID);
            if (!doctor) {
              logger.warn({ event: 'service_createUser_doctor_not_found', doctorId, organizationID });
            } else {
              const doctorFullName = doctor.namePrefix && String(doctor.namePrefix).toLowerCase().includes('dr')
                ? `${doctor.namePrefix} ${doctor.fullName || doctor.firstName || ''}`.trim()
                : (doctor.fullName || doctor.firstName || '');
              const userFullName = user.fullName ?? `${user.firstName || ''} ${user.lastName || ''}`.trim();
              const linkResult = await userLinkRepository.linkUser({
                userID: user.userID,
                organizationID,
                body: {
                  action: 'add',
                  reporter: {
                    id: doctorId,
                    name: doctorFullName,
                  },
                  assignees: [
                    {
                      id: user.userID,
                      name: userFullName || user.userID,
                    },
                  ],
                },
              });
              if (!linkResult) {
                logger.warn({ event: 'service_createUser_doctor_link_failed', doctorId, userId: user.userID });
              } else {
                logger.info({ event: 'service_createUser_doctor_linked', doctorId, userId: user.userID });
              }
            }
          } catch (err) {
            logger.warn({ event: 'service_createUser_doctor_link_error', err: serializeError(err) });
          }
        } else {
          logger.warn({ event: 'service_createUser_doctor_missing_id' });
        }
      }

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

        const definedRoleCode = String((user as any).definedRoleCode || '').toUpperCase();
        const isFnfRole = definedRoleCode === 'FRIEND' || definedRoleCode === 'FAMILY';
        if (isFnfRole) {
          logger.info({ event: 'service_createUser_notification_skipped', definedRoleCode });
        } else {
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
        }
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
    updates: Partial<User>,
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

      // Normalize phone number if being updated
      if (updates.phoneNumber !== undefined) {
        const rawPhone = String(updates.phoneNumber).trim();
        updates.phoneNumber = rawPhone; // Keep raw phone for DB
      }

      // Normalize email if being updated
      if (updates.emailAddress !== undefined) {
        updates.emailAddress = String(updates.emailAddress).trim().toLowerCase();
      }

      // Handle name splitting if fullName is provided
      if (updates.fullName !== undefined && !updates.firstName && !updates.lastName) {
        const fullNameStr = String(updates.fullName).trim();
        const regex = /^(\S+)\s+(.+)/;
        const match = fullNameStr.match(regex);
        if (match) {
          updates.firstName = match[1];
          updates.lastName = match[2];
        } else {
          updates.firstName = fullNameStr;
          updates.lastName = '';
        }
      }

      // Set modifiedDate
      updates.modifiedDate = Date.now();

      await this.repository.updateUser(userId, organizationId, updates);
      const updated = await this.repository.getUser(userId, organizationId);
      if (!updated) {
        throw new UserNotFoundError(userId);
      }

      // Best-effort notification that profile changed
      try {
        const notifyEmail = updates.emailAddress ?? updated.emailAddress;
        const notifyName = updates.fullName ?? updated.fullName ?? updated.firstName;
        await notifyUser({
          userId: updated.userID,
          email: notifyEmail,
          name: notifyName,
          channels: updates.emailAddress ? ['email'] : [],
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

  async deleteUser(userId: string, organizationId: string, correlationId?: string): Promise<void> {
    const timer = createPerformanceTimer(baseLogger, 'deleteUser', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, userId });
    logger.info({ event: 'service_deleteUser_start' });

    try {
      const existing = await this.repository.getUser(userId, organizationId);
      if (!existing) {
        throw new UserNotFoundError(userId);
      }

      await this.repository.deleteUser(userId, organizationId);

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

  async listOrganizationUsers(
    organizationId: string,
    options?: ListOrganizationUsersOptions,
  ): Promise<User[]> {
    const timer = createPerformanceTimer(baseLogger, 'listOrganizationUsers');
    const logger = createChildLogger(baseLogger, { organizationId });
    logger.info({ event: 'service_listOrganizationUsers_start' });

    try {
      const users = await this.repository.listOrganizationUsers(organizationId, options);
      logger.info({ event: 'service_listOrganizationUsers_success', count: users.length });
      timer.end();
      return users;
    } catch (err) {
      logger.error({ event: 'service_listOrganizationUsers_error', err: serializeError(err) });
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

  /**
   * Get user with comprehensive organization details, roles, permissions, and preferences
   * This implements the logic from the legacy applyValidation function
   */
  async getUserWithOrganizationDetails(
    userId: string,
    organizationId: string,
    requestingUserId?: string,
    defaultProfile?: string,
    userType?: string,
    authHeader?: string,
  ): Promise<any> {
    const timer = createPerformanceTimer(baseLogger, 'getUserWithOrganizationDetails');
    const logger = createChildLogger(baseLogger, { userId, organizationId, requestingUserId });
    logger.info({ event: 'service_getUserWithOrganizationDetails_start' });

    try {
      // Handle default profile (family member access)
      let actualUserId = userId;
      let fnfDetails: User | null = null;

      if (defaultProfile && defaultProfile !== '') {
        actualUserId = defaultProfile;
        fnfDetails = await this.repository.getUser(userId, organizationId);
      } else if (!actualUserId) {
        actualUserId = requestingUserId || userId;
      }

      // First, try to get the user using the organizationId (new schema: pk=ORG#orgId, sk=USER#userId)
      let userBasicDetails = await this.repository.getUser(actualUserId, organizationId);
      
      // If not found with organizationId, try legacy schema (pk=USER#userId, sk=USER_DETAILS)
      if (!userBasicDetails) {
        userBasicDetails = await this.repository.getUser(actualUserId);
      }

      if (!userBasicDetails) {
        throw new UserNotFoundError(actualUserId);
      }

      // Get organization details
      let orgBasicDetails: any = null;
      const userOrgId = userBasicDetails.organizationID || organizationId;
      if (userOrgId && userOrgId !== 'ROOT') {
        orgBasicDetails = await this.organizationRepository.getOrganization(userOrgId, authHeader);
      }

      // Get all related user data items (preferences, metadata, etc.) using pk=USER#userId
      const allUserData = await this.repository.getAllUserData(actualUserId);
      
      // Find preference details from allUserData
      const preferenceDetails = allUserData.find((item: any) => 
        item.sk?.includes('PREFERENCE') || item.sk === 'PREFERENCE' || item.sk?.startsWith('PREFERENCE')
      );

      // Get roles and permissions
      let roleDetails: any[] = [];
      let roleName = '';
      let userPermissions: any = null;
      let isDefault = false;
      let definedRoleCode: string | null = null;
      let roleType: string | null = null;
      let roleId: string | null = null;
      let filteredRoles: string[] = [];
      let uniquePermissions: any = {};

      // Try to get user roles from role API
      const roleApiUrl = process.env.ROLE_API_URL;
      if (roleApiUrl && userOrgId) {
        try {
          const rolesUrl = `${roleApiUrl.replace(/\/$/, '')}/org/${userOrgId}/users/${actualUserId}/roles`;
          const rolesResponse = await fetch(rolesUrl, {
            headers: {
              'Content-Type': 'application/json',
              ...(authHeader ? { Authorization: authHeader } : {}),
            },
          });

          if (rolesResponse.ok) {
            const rolesData = (await rolesResponse.json()) as any;
            filteredRoles = rolesData?.data?.roles || rolesData?.roles || [];
            
            if (filteredRoles.length > 0) {
              roleId = filteredRoles[0];
              roleDetails = await getRoleDetails(roleId, userOrgId, authHeader);
              
              if (roleDetails && roleDetails.length > 0) {
                const roleDetail = Array.isArray(roleDetails) ? roleDetails[0] : roleDetails;
                roleName = roleDetail?.roleName || roleDetail?.definedRoleCode || '';
                userPermissions = roleDetail?.features || {};
                isDefault = roleDetail?.isDefault ?? false;
                definedRoleCode = roleDetail?.definedRoleCode ?? null;
                roleType = roleDetail?.roleType ?? null;
              }

              // Get unique permissions
              try {
                const permissionsUrl = `${roleApiUrl.replace(/\/$/, '')}/org/${userOrgId}/users/${actualUserId}/permissions`;
                const permissionsResponse = await fetch(permissionsUrl, {
                  headers: {
                    'Content-Type': 'application/json',
                    ...(authHeader ? { Authorization: authHeader } : {}),
                  },
                });

                if (permissionsResponse.ok) {
                  const permissionsData = (await permissionsResponse.json()) as any;
                  const permissions = permissionsData?.data?.permissions || permissionsData?.permissions || [];
                  uniquePermissions = this.getUniquePermissions(permissions);
                }
              } catch (err) {
                logger.warn({ event: 'get_permissions_error', err: serializeError(err) });
              }
            }
          }
        } catch (err) {
          logger.warn({ event: 'get_roles_error', err: serializeError(err) });
        }
      }

      // Calculate account age
      const accountAge = this.calculateAccountAge(userBasicDetails.createdDate || Date.now());

      // Build schedule configuration from preferences
      let scheduleConfiguration: any = {};
      if (preferenceDetails) {
        const { pk, sk, userID, createdDate, modifiedDate, organizationID, ...rest } = preferenceDetails;
        scheduleConfiguration = { ...rest };
      }

      // Get user category
      let userCategory = userBasicDetails.userCat?.[0] || userType || 'USER';

      // Get currencies (placeholder - would need currency API)
      const currencies: any[] = [];

      // Get email/phone verification status
      let emailVerified = false;
      let phoneVerified = false;
      // This would typically come from Cognito or a verification service
      // For now, we'll use the values from userBasicDetails if available
      emailVerified = userBasicDetails.emailVerified || false;
      phoneVerified = userBasicDetails.phoneVerified || false;

      // Build response data
      const data: any = {
        userID: actualUserId,
        emailVerified,
        phoneVerified,
        firstName: userBasicDetails.firstName || '',
        middleName: userBasicDetails.middleName || '',
        lastName: userBasicDetails.lastName || '',
        mrn: userBasicDetails.mrn || '',
        emailAddress: userBasicDetails.emailAddress || '',
        phoneNumber: userBasicDetails.phoneNumber || '',
        profilePic: userBasicDetails.profilePic || '',
        organizationID: userBasicDetails.organizationID || userOrgId || '',
        fullName: userBasicDetails.fullName || '',
        gender: userBasicDetails.gender || '',
        weightInLbs: userBasicDetails.weightInLbs || '',
        weightInKG: userBasicDetails.weightInKG || '',
        heightInCm: userBasicDetails.heightInCm || '',
        heightInFeet: userBasicDetails.heightInFeet || '',
        cloudOpt: userBasicDetails.cloudOpt || '',
        country: userBasicDetails.country || '',
        language: userBasicDetails.language || orgBasicDetails?.organizationInfo?.defaultSetting?.languages?.[0]?.langCode || 'en',
        dateOfBirth: userBasicDetails.dateOfBirth || '',
        address: userBasicDetails.address || '',
        allergies: userBasicDetails.medicalHistory?.allergies || [],
        chiefMedicalIssue: (userBasicDetails.medicalHistory as any)?.chiefMedicalIssue || (userBasicDetails as any).chiefMedicalIssue || '',
        smoking: (userBasicDetails.medicalHistory as any)?.smoking || '',
        alcoholConsumption: (userBasicDetails.medicalHistory as any)?.alcoholConsumption || '',
        additionalPhoneNumbers: userBasicDetails.additionalPhoneNumbers || [],
        additionalEmailIDs: userBasicDetails.additionalEmailIDs || [],
        srcRegisEntity: userBasicDetails.srcRegisEntity || '',
        accountAge: accountAge || { years: 0, months: 0, days: 0 },
        isRegisteredCompletely: userBasicDetails.isRegisteredCompletely || false,
        appName: userBasicDetails.appName || '',
        accountStatus: userBasicDetails.accountStatus || '',
        phoneLocale: userBasicDetails.phoneLocale || '',
        locale: userBasicDetails.locale || '',
        userTimeZone: userBasicDetails.userTimeZone || '',
        stateCode: userBasicDetails.stateCode || '',
        countryCode: userBasicDetails.countryCode || '',
        currencies,
        region: userBasicDetails.region || '',
        pushToken: (userBasicDetails as any).pushToken || '',
        platform: (userBasicDetails as any).platform || '',
        voipToken: (userBasicDetails as any).voipToken || '',
        assignRoomNo: userBasicDetails.assignRoomNo || '',
        organizationName: orgBasicDetails?.organizationInfo?.organizationName || orgBasicDetails?.organizationInfo?.name || '',
        organizationAddress: orgBasicDetails?.organizationInfo?.address || {},
        organizationEmailAddress: orgBasicDetails?.adminDetails?.emailAddress || '',
        scheduleConfiguration,
        roleName,
        userRoles: filteredRoles,
        roleType,
        roleId,
        permission: uniquePermissions,
        changePassword: userBasicDetails.changePassword || false,
        isRpmUser: userBasicDetails.isRpmUser || false,
        lastAppointment: userBasicDetails.lastAppointment || '',
        state: userBasicDetails.state || '',
        city: userBasicDetails.city || '',
        street: userBasicDetails.street || '',
        isActive: userBasicDetails.isActive || false,
        emergencyContact: userBasicDetails.emergencyContact || {},
        insuranceDetails: userBasicDetails.insuranceDetails || {},
        medicalHistory: userBasicDetails.medicalHistory || {},
        namePrefix: userBasicDetails.namePrefix || '',
        mfaEnabled: (userBasicDetails as any).mfaEnabled || false,
        phoneCode: userBasicDetails.phoneCode || '',
        zip: userBasicDetails.zip || userBasicDetails.postalCode || '',
        specialty: userBasicDetails.specialty || '',
        position: userBasicDetails.position || '',
        licenseNumber: userBasicDetails.licenseNumber || '',
        department: userBasicDetails.department || '',
        workSchedule: (userBasicDetails as any).workSchedule || {},
        isDeleted: (userBasicDetails as any).isDeleted || false,
        delete_request_time: (userBasicDetails as any).delete_request_time || '',
        ethnicity: userBasicDetails.ethnicity || '',
        maritalStatus: userBasicDetails.maritalStatus || '',
        bloodGroup: userBasicDetails.bloodGroup || '',
        appleHealthLastSync: userBasicDetails.appleHealthLastSync || '',
        googleFitLastSync: userBasicDetails.googleFitLastSync || '',
        experienceInYears: userBasicDetails.experienceInYears || '',
        bio: userBasicDetails.bio || '',
        workingHours: userBasicDetails.workingHours || {},
        userType: userCategory,
        fnfDetails: fnfDetails ? {
          userID: userId,
          firstName: fnfDetails.firstName || '',
          middleName: fnfDetails.middleName || '',
          lastName: fnfDetails.lastName || '',
          emailAddress: fnfDetails.emailAddress || '',
          phoneNumber: fnfDetails.phoneNumber || '',
          profilePic: fnfDetails.profilePic || '',
          organizationID: fnfDetails.organizationID || '',
          fullName: fnfDetails.fullName || '',
          gender: fnfDetails.gender || '',
          permissions: this.makeFamilyPermissionReadonly(uniquePermissions),
        } : null,
        generalSettings: {
          promotions: (userBasicDetails as any).promotions !== undefined ? (userBasicDetails as any).promotions : true,
          medication: (userBasicDetails as any).medication !== undefined ? (userBasicDetails as any).medication : true,
          appointment: (userBasicDetails as any).appointment !== undefined ? (userBasicDetails as any).appointment : true,
          newsAndArticles: (userBasicDetails as any).newsAndArticles !== undefined ? (userBasicDetails as any).newsAndArticles : true,
          emergencyVital: (userBasicDetails as any).emergencyVital !== undefined ? (userBasicDetails as any).emergencyVital : true,
          medicationReminders: (userBasicDetails as any).medicationReminders !== undefined ? (userBasicDetails as any).medicationReminders : true,
          appointmentReminders: (userBasicDetails as any).appointmentReminders !== undefined ? (userBasicDetails as any).appointmentReminders : true,
          activityGoals: (userBasicDetails as any).activityGoals !== undefined ? (userBasicDetails as any).activityGoals : true,
          healthCheckIn: (userBasicDetails as any).healthCheckIn !== undefined ? (userBasicDetails as any).healthCheckIn : true,
          debugMode: (userBasicDetails as any).debugMode || false,
        },
        communicationSettings: {
          sms: (userBasicDetails as any).sms !== undefined ? (userBasicDetails as any).sms : orgBasicDetails?.organizationInfo?.defaultSetting?.notifications?.sms,
          chat_with_push: (userBasicDetails as any).chat_with_push !== undefined ? (userBasicDetails as any).chat_with_push : orgBasicDetails?.organizationInfo?.defaultSetting?.notifications?.chat_with_push,
          email: (userBasicDetails as any).email !== undefined ? (userBasicDetails as any).email : orgBasicDetails?.organizationInfo?.defaultSetting?.notifications?.email,
          push: (userBasicDetails as any).push !== undefined ? (userBasicDetails as any).push : orgBasicDetails?.organizationInfo?.defaultSetting?.notifications?.push,
          chat: (userBasicDetails as any).chat !== undefined ? (userBasicDetails as any).chat : orgBasicDetails?.organizationInfo?.defaultSetting?.notifications?.chat,
        },
        tabBar: orgBasicDetails?.organizationInfo?.defaultSetting?.tabBar || [],
        dateFormat: userBasicDetails.dateFormat || orgBasicDetails?.organizationInfo?.defaultSetting?.dateFormat?.[0] || 'MM/DD/YYYY',
        acceptedAppForms: userBasicDetails.acceptedAppForms || [],
        userPermissions,
        isDefault,
        definedRoleCode,
      };

      // Add reporter details if available
      if (userBasicDetails.reporterId) {
        const reporterDetails = await this.repository.getUser(userBasicDetails.reporterId, userOrgId);
        if (reporterDetails) {
          data.reporterId = userBasicDetails.reporterId;
          data.reporterProfilePic = reporterDetails.profilePic || '';
          data.reporterSpecialty = reporterDetails.specialty || '';
          data.reporterName = reporterDetails.fullName || 
            (reporterDetails.firstName && reporterDetails.lastName ? `${reporterDetails.firstName} ${reporterDetails.lastName}` : 
            reporterDetails.firstName || '');
        }
      }

      // Add referred, careManager, dietician, healthCoach if available
      if ((userBasicDetails as any).referred) data.referred = (userBasicDetails as any).referred;
      if ((userBasicDetails as any).careManager) data.careManager = (userBasicDetails as any).careManager;
      if ((userBasicDetails as any).dietician) data.dietician = (userBasicDetails as any).dietician;
      if ((userBasicDetails as any).healthCoach) data.healthCoach = (userBasicDetails as any).healthCoach;

      // Fitness apps
      data.fitnessApps = {
        garmin: !!(userBasicDetails as any).garmin,
        fitbit: !!(userBasicDetails as any).fitbit,
      };

      // Task completion status
      data.isTaskCompleted = userBasicDetails.isTaskCompleted !== undefined 
        ? userBasicDetails.isTaskCompleted 
        : false; // Would need to check completed tasks

      // Format full name with prefix
      if (data.namePrefix?.includes('Dr.') || data.namePrefix?.includes('DR')) {
        data.fullName = `${data.namePrefix} ${data.fullName}`.trim();
      }

      logger.info({ event: 'service_getUserWithOrganizationDetails_success' });
      timer.end();
      return data;
    } catch (err) {
      logger.error({ event: 'service_getUserWithOrganizationDetails_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  /**
   * Calculate account age from created date
   */
  private calculateAccountAge(createdEpoch: number): { years: number; months: number; days: number } {
    const currentTimestamp = Date.now();
    const currentDate = new Date(currentTimestamp);
    const createdDate = new Date(createdEpoch);

    let years = currentDate.getFullYear() - createdDate.getFullYear();
    let months = currentDate.getMonth() - createdDate.getMonth();
    let days = currentDate.getDate() - createdDate.getDate();

    // Adjust for negative values
    if (months < 0 || (months === 0 && days < 0)) {
      years--;
      months += 12;
    }

    // Adjust for leap years
    for (let i = createdDate.getFullYear(); i < currentDate.getFullYear(); i++) {
      if (this.isLeapYear(i)) {
        days += 1;
      }
    }

    return { years, months, days };
  }

  /**
   * Check if year is a leap year
   */
  private isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  /**
   * Get unique permissions from array of permission objects
   */
  private getUniquePermissions(permissions: any[]): any {
    const maxValues: any = {};
    if (permissions && permissions.length > 0) {
      permissions.forEach((obj: any) => {
        Object.keys(obj).forEach((key) => {
          if (!(key in maxValues)) {
            maxValues[key] = obj[key];
          } else {
            Object.keys(obj[key] || {}).forEach((subKey) => {
              if (!(subKey in maxValues[key]) || obj[key][subKey] > maxValues[key][subKey]) {
                maxValues[key][subKey] = obj[key][subKey];
              }
            });
          }
        });
      });
      return maxValues;
    }
    return {};
  }

  /**
   * Make family permissions readonly (except chat and schedule)
   */
  private makeFamilyPermissionReadonly(permissions: any): any {
    const readonlyPermissions: any = {};
    Object.keys(permissions).forEach((key) => {
      if (key === 'chat' || key === 'schedule') {
        readonlyPermissions[key] = permissions[key];
      } else {
        readonlyPermissions[key] = {};
        Object.keys(permissions[key] || {}).forEach((subKey) => {
          readonlyPermissions[key][subKey] = 1; // Readonly
        });
      }
    });
    return readonlyPermissions;
  }
}

