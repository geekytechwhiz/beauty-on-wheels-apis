import { createChildLogger, createLogger, createPerformanceTimer, serializeError } from '@api-hub/logger';
import { randomUUID } from 'crypto';
import { ulid } from 'ulid';
import { publishEvent } from '../events/event.publisher';
import { User, UserFile, UserMetadata, UserOrganization, UserResponse } from '../models';
import { OrganizationRepository } from '../repositories/organization.repository';
import { PackageRepository } from '../repositories/package.repositrory';
import { RoleRepository } from '../repositories/role.repository';
import { ListOrganizationUsersOptions, UserRepository } from '../repositories/user.repository';
import { UserAlreadyExistsError, UserNotFoundError } from '../utils/errors';
import { CognitoService } from './cognito.service';
import { FriendFamilyService } from './friendFamily.service';
import { notifyUser } from './notification.service';
import { getOrganization as getOrganizationViaApi } from './organization.service';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const roleRepository = new RoleRepository();
const packageRepository = new PackageRepository();

const friendFamilyService = new FriendFamilyService();
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

  async getUserByExternalIdentity(
    tenant: string,
    provider: string,
    externalUserId: string,
  ): Promise<User | null> {
    return this.repository.getUserByExternalIdentity(
      tenant,
      provider,
      externalUserId,
    );
  }

  async createUser(
    data: Partial<User>,
    roleName: string,
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
    const stepDuration = (stepName: string, startTime: number, meta: Record<string, unknown> = {}) => {
      logger.info({
        event: 'service_createUser_step_timing',
        step: stepName,
        durationMs: Date.now() - startTime,
        ...meta,
      });
    };
    try {
      if (!organizationID) throw new Error('organizationID is required');
      data.organizationID = organizationID;
      const orgFetchStart = Date.now();
      const fetchedOrgDetails = await this.organizationRepository.getOrganizationFromDB(data?.organizationID || '');
      if (!fetchedOrgDetails) {
        throw new Error('Organization does not exist');
      }
      const orgDetails: any = fetchedOrgDetails;
      const orgStatus = String(
        orgDetails.status ??
          orgDetails.lsi_status ??
          orgDetails.organizationInfo?.status ??
          '',
      ).toLowerCase();
      if (['on_hold', 'disabled', 'not_exist'].includes(orgStatus)) {
        throw new Error('Organization is not available');
      }
      stepDuration('organization_validation', orgFetchStart, {
        source: 'db',
        found: true,
      });

 
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
      const allowedUserTypes = ['STAFF', 'USER', 'ADMIN', 'FNF'];
      if (!allowedUserTypes.includes(userTypeUpper)) {
        throw new Error(`Invalid user type ${userTypeUpper}, only ${allowedUserTypes.join(', ')} are allowed`);
      }
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
          const cognitoTotalStart = Date.now();
          const cognitoService = new CognitoService(
            process.env.DEFAULT_AWS_REGION || 'us-east-1',
            process.env.COGNITO_USER_POOL_ID || ''
          );
          const cognitoExistenceStart = Date.now();
          const [existsEmail, existsPhone] = await Promise.all([
            normalizedEmail ? cognitoService.userExistsIdentifier(normalizedEmail) : Promise.resolve(false),
            normalizedPhone ? cognitoService.userExistsIdentifier(normalizedPhone) : Promise.resolve(false),
          ]);
          stepDuration('cognito_existence_checks', cognitoExistenceStart, {
            checkedEmail: !!normalizedEmail,
            checkedPhone: !!normalizedPhone,
          });
          if (existsEmail) {
            throw new UserAlreadyExistsError(normalizedEmail);
          }
          if (existsPhone) {
            throw new UserAlreadyExistsError(normalizedPhone);
          }

          const explicitUsername = (data as any).username && String((data as any).username).trim() !== '' 
            ? String((data as any).username).trim() 
            : null;
          const username = explicitUsername || normalizedEmail || normalizedPhone;
          
          const permissionIds: string[] = []; // Permissions would come from role service
          const externalIdentity: any = data.externalIdentity  

          logger.info({
            event: 'service_createUser_external_identity_received',
            correlationId,
            userId: data.userID,
            organizationID,
            integrationType: externalIdentity?.integrationType,
            externalUserId: externalIdentity?.externalUserId,
            externalHospitalId: externalIdentity?.externalHospitalId,
            subdomain: externalIdentity?.subdomain,
            provider: externalIdentity?.provider,
            sourceSystem: externalIdentity?.sourceSystem,
          });
          if (externalIdentity?.sourceSystem === 'HMS') {
            logger.info({
              event: 'service_createUser_hms_user_detected',
              correlationId,
              userId: data.userID,
              externalUserId: externalIdentity.externalUserId,
              hospitalId: externalIdentity.externalHospitalId,
              provider: externalIdentity.provider,
              subdomain: externalIdentity.subdomain,
            });
          }
          const cognitoCreateStart = Date.now();
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
                roleName: String(roleName || ''),
                permissions: JSON.stringify(permissionIds),
              },
            },
          );
          stepDuration('cognito_create_user', cognitoCreateStart);
          stepDuration('cognito_total', cognitoTotalStart);
          logger.info({
            event: 'service_createUser_cognito_payload',
            correlationId,
            username,
            email: normalizedEmail,
            phone: normalizedPhone,
            organizationID,
            externalIdentity: {
              integrationType: externalIdentity?.integrationType,
              externalUserId: externalIdentity?.externalUserId,
              externalHospitalId: externalIdentity?.externalHospitalId,
              subdomain: externalIdentity?.subdomain,
              provider: externalIdentity?.provider,
              sourceSystem: externalIdentity?.sourceSystem,
            }
          });
          logger.info({ event: 'service_createUser_cognito_success', email: normalizedEmail, phone: normalizedPhone, username });
        } catch (err) {
          if (err instanceof UserAlreadyExistsError) {
            logger.error({ event: 'service_createUser_cognito_error', email: normalizedEmail, phone: normalizedPhone, err: serializeError(err) });
            throw err;
          }

          logger.error({
            event: 'service_createUser_cognito_error',
            correlationId,
            email: normalizedEmail,
            phone: normalizedPhone,
            organizationID,
            externalIdentity: {
              integrationType: data?.externalIdentity?.integrationType,
              externalUserId: data?.externalIdentity?.externalUserId,
              externalHospitalId: data?.externalIdentity?.externalHospitalId,
              subdomain: data?.externalIdentity?.subdomain,
              provider: data?.externalIdentity?.provider,
              sourceSystem: data?.externalIdentity?.sourceSystem,
            },
            provider: data?.externalIdentity?.provider,
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
      
      // Preserve definedRoleCode explicitly to ensure it's saved to DB
      const definedRoleCode = (data as any).definedRoleCode;
      logger.info({ event: 'service_createUser_definedRoleCode_check', definedRoleCode, hasDefinedRoleCode: definedRoleCode !== undefined });
      
      const { __skipOrganizationValidation, ...sanitizedData } = data as any;
      void __skipOrganizationValidation;
      const user: User = {
        ...sanitizedData,
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
        ...(definedRoleCode !== undefined ? { definedRoleCode: String(definedRoleCode) } : {}),
        
      } as User;
      
      logger.info({ event: 'service_createUser_user_object', hasDefinedRoleCode: (user as any).definedRoleCode !== undefined, definedRoleCode: (user as any).definedRoleCode });

      const dbCreateUserStart = Date.now();
      await this.repository.createUser(user);
      stepDuration('db_create_user', dbCreateUserStart);

      // Add user-organization mapping (future multi-org support)
      const dbAssignOrgStart = Date.now();
      await this.repository.assignUserToOrganization(user);
      stepDuration('db_assign_user_to_org', dbAssignOrgStart);

      const postCreateTasks = async () => {
        const postCreateStart = Date.now();
        if (friendNFamily && Object.keys(friendNFamily).length > 0 && organizationID) {
          const fnfStart = Date.now();
          const fullNameRaw = String((friendNFamily as any).name || '').trim();
          const fnfEmail = String((friendNFamily as any).email || '').trim();
          const fnfPhoneCode = String((friendNFamily as any).phoneCode || '').trim();
          const fnfPhone = String((friendNFamily as any).phone || '').trim();
          const fullPhoneNumber = fnfPhoneCode ? `${fnfPhoneCode}${fnfPhone}` : fnfPhone;
          const friendNFamilyFullName = fullNameRaw || 'F&F Member';
          const relationRaw = String((friendNFamily as any).relation || 'family').toLowerCase();
          const relation = relationRaw === 'friend' ? 'FRIEND' : 'FAMILY';
          const relationship = relation === 'FAMILY' ? (relationRaw !== 'friend' ? String((friendNFamily as any).relation || '').trim() : '') : '';
          const userName = (user.fullName ?? `${(user as any).firstName ?? ''} ${(user as any).lastName ?? ''}`.trim()) || user.userID;
          try {
            const searchResult = await friendFamilyService.searchFnf(
              organizationID,
              user.userID,
              {
                email: fnfEmail || undefined,
                phone: fullPhoneNumber || undefined,
                fullName: friendNFamilyFullName,
                invite: fnfEmail ? 'email' : 'phone',
                relation,
                relationship,
                emergencyContact: true,
              },
              authHeader,
            );
            const memberId = searchResult?.invitedUser;
            if (searchResult?.success && memberId) {
              await friendFamilyService.addMember(
                organizationID,
                {
                  userId: user.userID,
                  memberId,
                  userName,
                  memberName: friendNFamilyFullName,
                  relation,
                  relationship,
                  emergencyContact: true,
                  manageHealth: false,
                },
                authHeader,
              );
              logger.info({ event: 'service_createUser_friend_family_linked', memberId, userId: user.userID });
            } else {
              logger.warn({ event: 'service_createUser_friend_family_not_found', message: 'F&F user not found; invite separately or add via add-member after invite' });
            }
          } catch (err) {
            logger.warn({ event: 'service_createUser_friend_family_failed', err: serializeError(err) });
          } finally {
            stepDuration('post_create_friend_family', fnfStart);
          }
        }

        if (assignDoctor && Object.keys(assignDoctor).length > 0 && organizationID) {
          const doctorStart = Date.now();
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
                await this.repository.saveDoctorPatientLink(doctorId, user.userID, organizationID);
                await this.repository.updatePatientReporter(user.userID, organizationID, {
                  reporterId: doctorId,
                  reporterName: doctorFullName,
                  reporterProfilePic: (doctor as any).profilePic,
                  reporterEmail: (doctor as any).emailAddress,
                });
                logger.info({ event: 'service_createUser_doctor_linked', doctorId, userId: user.userID });
              }
            } catch (err) {
              logger.warn({ event: 'service_createUser_doctor_link_error', err: serializeError(err) });
            }
          } else {
            logger.warn({ event: 'service_createUser_doctor_missing_id' });
          }
          stepDuration('post_create_doctor_assignment', doctorStart);
        }

        try {
        const userTypeUpper = String(user.userType || '').toUpperCase();
        const isStaff = userTypeUpper === 'STAFF';
        const template = isStaff ? 'WELCOME_STAFF' : 'WELCOME_USER';

        // Build notifyPhone from user (saved shape) with fallback to request data so SMS is sent when phone was provided
        const phoneRaw = (user.phoneNumber && String(user.phoneNumber).trim()) || ((data as any).phoneNumber && String((data as any).phoneNumber).trim()) || '';
        const phoneCodeRaw = String(user.phoneCode || (data as any).phoneCode || '').trim();
        let notifyPhone: string | undefined = undefined;
        if (phoneRaw) {
          if (phoneCodeRaw) {
            notifyPhone = phoneCodeRaw.startsWith('+') ? `${phoneCodeRaw}${phoneRaw}` : `+${phoneCodeRaw}${phoneRaw}`;
            logger.info({
              event: 'service_createUser_notifyPhone_built',
              condition: 'phone_and_code',
              hasPhoneRaw: true,
              hasPhoneCodeRaw: true,
              notifyPhoneLength: notifyPhone?.length,
              source: { fromUser: !!user.phoneNumber, fromData: !!(data as any).phoneNumber },
            });
          } else {
            notifyPhone = phoneRaw.startsWith('+') ? phoneRaw : `+${phoneRaw}`;
            logger.info({
              event: 'service_createUser_notifyPhone_built',
              condition: 'phone_only',
              hasPhoneRaw: true,
              hasPhoneCodeRaw: false,
              notifyPhoneLength: notifyPhone?.length,
              source: { fromUser: !!user.phoneNumber, fromData: !!(data as any).phoneNumber },
            });
          }
        } else {
          logger.info({
            event: 'service_createUser_notifyPhone_skipped',
            condition: 'no_phone',
            userPhoneNumber: !!user.phoneNumber,
            dataPhoneNumber: !!(data as any).phoneNumber,
            message: 'SMS will not be sent: no phone number from user or request data',
          });
        }

        const deviceToken = (user as any).deviceToken || (user as any).device || undefined;

        const channels = [
          ...(user.emailAddress ? ['email'] : []),
          ...(notifyPhone ? ['sms'] : []),
          ...(deviceToken ? ['push'] : []),
        ];

        logger.info({
          event: 'service_createUser_channels_built',
          channels,
          emailIncluded: !!user.emailAddress,
          smsIncluded: !!notifyPhone,
          pushIncluded: !!deviceToken,
          message: `Channels: email=${!!user.emailAddress}, sms=${!!notifyPhone}, push=${!!deviceToken}`,
        });

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
          // SMS placeholders used by template.registry.ts for welcome messages.
          ACCOUNT_CREATED_INFO: 'Your account has been created successfully.',
          ANDROID_APP_URL: process.env.ANDROID_APP_URL || '',
          IOS_APP_URL: process.env.IOS_APP_URL || '',
        };

        // Extend templateData based on user type (STAFF / USER / FNF)
        const templateData: Record<string, unknown> = { ...baseTemplateData };

        if (userTypeUpper === 'STAFF') {
          console.log("USER TYPE STAFF")
          console.log("TEMPLATE DATA: STAFF", templateData);
          console.log("TEMPLATE: STAFF", template);
          Object.assign(templateData, {
            STAFF_FIRST_NAME: user.firstName,
            PORTAL_LINK: process.env.PORTAL_LINK || '',
            ORG_ADDRESS: orgAddress,
          });
        } else if (userTypeUpper === 'FNF') {
          console.log("USER TYPE FNF")
          console.log("TEMPLATE DATA: FNF", templateData);
          console.log("TEMPLATE: FNF", template);
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
          console.log("USER TYPE NOT STAFF AND FNF")
          console.log("TEMPLATE DATA: 123", templateData);
          console.log("TEMPLATE: 123", template);
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
          logger.info({
            event: 'service_createUser_notification_skipped',
            condition: 'fnf_role',
            definedRoleCode,
            isFnfRole: true,
            message: 'Notification skipped for FRIEND/FAMILY role; no email or SMS sent',
          });
        } else {
          logger.info({
            event: 'service_createUser_notifyUser_calling',
            condition: 'notification_send',
            userId: user.userID,
            channels,
            hasPhone: !!notifyPhone,
            hasEmail: !!user.emailAddress,
            template,
            message: 'Publishing UserCreatedNotificationRequested to SNS',
          });
          console.log("TEMPLATE DATA: ", templateData);
          console.log("TEMPLATE: ", template);
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
          logger.info({
            event: 'service_createUser_notifyUser_done',
            condition: 'notification_published',
            userId: user.userID,
            channels,
            message: 'notifyUser completed successfully',
          });
        }
        } catch (notifyErr) {
          logger.warn({
            event: 'service_createUser_notification_failed',
            condition: 'notify_error',
            err: serializeError(notifyErr),
            userId: user.userID,
            message: 'notifyUser threw; check USER_EVENTS_TOPIC_ARN and SNS permissions',
          });
        }
        stepDuration('post_create_total', postCreateStart);
      };

      const syncPostCreateTasks =
        String(process.env.CREATE_USER_SYNC_POST_CREATE_TASKS || '').toLowerCase() === 'true';
      if (syncPostCreateTasks) {
        await postCreateTasks();
      } else {
        await postCreateTasks().catch((postCreateErr) => {
          logger.warn({
            event: 'service_createUser_post_create_async_failed',
            userId: user.userID,
            err: serializeError(postCreateErr),
          });
        });
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

  /**
   * Merges multiple permission objects, taking max values for conflicts
   * Based on old implementation: getUniquePermissions
   */
  private getUniquePermissions(permissions: any[]): any {
    const maxValues: any = {};
    if (permissions && permissions.length > 0) {
      permissions.forEach((obj) => {
        if (obj && typeof obj === 'object') {
          Object.keys(obj).forEach((key) => {
            if (!(key in maxValues)) {
              maxValues[key] = obj[key];
            } else {
              // If both are objects, merge recursively
              if (typeof obj[key] === 'object' && typeof maxValues[key] === 'object' && !Array.isArray(obj[key]) && !Array.isArray(maxValues[key])) {
                Object.keys(obj[key]).forEach((subKey) => {
                  if (!(subKey in maxValues[key]) || obj[key][subKey] > maxValues[key][subKey]) {
                    maxValues[key][subKey] = obj[key][subKey];
                  }
                });
              } else if (typeof obj[key] === 'number' && typeof maxValues[key] === 'number') {
                maxValues[key] = Math.max(maxValues[key], obj[key]);
              }
            }
          });
        }
      });
      return maxValues;
    }
    return {};
  }

  /**
   * Safely converts a value to a string, returning empty string if conversion fails
   */
  private safeString(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    try {
      return String(value);
    } catch {
      return '';
    }
  }

  /**
   * Safely converts a value to a boolean, returning false if conversion fails
   */
  private safeBoolean(value: any): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return value;
    return value === true || value === 'true' || value === 1 || value === '1';
  }

  /**
   * Transforms User object to match the expected response structure
   * Includes comprehensive error handling to prevent runtime errors
   * Fetches all required data from DynamoDB (roles, permissions, currencies, etc.)
   */
  async transformUserForResponse(
    user: any, 
    organizationId: string, 
    userType?: string, 
    orgData?: any, 
    defaultProfile?: string
  ): Promise<any> {
    // Safety check: ensure user is an object
    if (!user || typeof user !== 'object') {
      return {};
    }
    
    // Ensure organizationId is a string
    const safeOrgId = this.safeString(organizationId);

    // Calculate account age with leap year adjustment
    const isLeapYear = (year: number) => {
      if (typeof year !== 'number' || isNaN(year)) return false;
      return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    };
    
    const calculateAccountAge = (createdEpoch: number | string | undefined): { years: number; months: number; days: number } => {
      try {
        if (!createdEpoch) return { years: 0, months: 0, days: 0 };
        
        const epochNum = typeof createdEpoch === 'string' ? parseInt(createdEpoch, 10) : createdEpoch;
        if (isNaN(epochNum) || !isFinite(epochNum)) return { years: 0, months: 0, days: 0 };

        const currentTimestamp = Date.now();
        const currentDate = new Date(currentTimestamp);
        const createdDate = new Date(epochNum);

        // Validate dates
        if (isNaN(currentDate.getTime()) || isNaN(createdDate.getTime())) {
          return { years: 0, months: 0, days: 0 };
        }

        let years = currentDate.getFullYear() - createdDate.getFullYear();
        let months = currentDate.getMonth() - createdDate.getMonth();
        let days = currentDate.getDate() - createdDate.getDate();

        // Adjust for negative values
        if (months < 0 || (months === 0 && days < 0)) {
          years--;
          months += 12;
        }

        // Adjust for leap years
        const startYear = createdDate.getFullYear();
        const endYear = currentDate.getFullYear();
        for (let i = startYear; i < endYear; i++) {
          if (isLeapYear(i)) {
            days += 1;
          }
        }

        return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days) };
      } catch (err) {
        return { years: 0, months: 0, days: 0 };
      }
    };

    const accountAge = user.createdDate ? calculateAccountAge(user.createdDate) : { years: 0, months: 0, days: 0 };

    // Extract allergies from medicalHistory if it exists - safe array check
    const allergies = Array.isArray(user.medicalHistory?.allergies) 
      ? user.medicalHistory.allergies 
      : (Array.isArray(user.allergies) ? user.allergies : []);
    const chiefMedicalIssue = user.medicalHistory?.chiefMedicalIssue || user.chiefMedicalIssue || '';
    const smoking = user.medicalHistory?.smoking || user.smoking || '';
    const alcoholConsumption = user.medicalHistory?.alcoholConsumption || user.alcoholConsumption || '';

    // Extract general settings - check if key exists in user object
    // Safety: ensure userKeys is always an array
    const userKeys = Array.isArray(Object.keys(user)) ? Object.keys(user) : [];
    const generalSettings = {
      promotions: userKeys.includes('promotions') ? user.promotions : true,
      medication: userKeys.includes('medication') ? user.medication : true,
      appointment: userKeys.includes('appointment') ? user.appointment : true,
      newsAndArticles: userKeys.includes('newsAndArticles') ? user.newsAndArticles : true,
      emergencyVital: userKeys.includes('emergencyVital') ? user.emergencyVital : true,
      medicationReminders: userKeys.includes('medicationReminders') ? user.medicationReminders : true,
      appointmentReminders: userKeys.includes('appointmentReminders') ? user.appointmentReminders : true,
      activityGoals: userKeys.includes('activityGoals') ? user.activityGoals : true,
      healthCheckIn: userKeys.includes('healthCheckIn') ? user.healthCheckIn : true,
      debugMode: userKeys.includes('debugMode') ? user.debugMode : false,
    };

    // Extract organization data - safe access with defaults
    const orgInfo = (orgData && typeof orgData === 'object' && orgData.organizationInfo) 
      ? orgData.organizationInfo 
      : {};
    const orgDefaultSetting = (orgInfo && orgInfo.defaultSetting) 
      ? orgInfo.defaultSetting 
      : ((orgData && typeof orgData === 'object' && orgData.defaultSetting) ? orgData.defaultSetting : {});
    const orgNotifications = (orgDefaultSetting && typeof orgDefaultSetting === 'object' && orgDefaultSetting.notifications)
      ? orgDefaultSetting.notifications
      : {};
    const orgUnits = (orgDefaultSetting && typeof orgDefaultSetting === 'object' && orgDefaultSetting.units)
      ? orgDefaultSetting.units
      : {};
    const orgLanguages = Array.isArray(orgDefaultSetting.languages) ? orgDefaultSetting.languages : [];
    const orgDateFormat = Array.isArray(orgDefaultSetting.dateFormat) ? orgDefaultSetting.dateFormat : [];
    const orgTabBar = Array.isArray(orgDefaultSetting.tabBar) ? orgDefaultSetting.tabBar : [];
    
    // Find default language (English) or first language - safe array operations
    let defaultLanguage = { langCode: 'en' };
    try {
      if (orgLanguages.length > 0) {
        const languageIndex = orgLanguages.findIndex((lang: any) => 
          lang && typeof lang === 'object' && lang.label === 'English'
        );
        defaultLanguage = languageIndex >= 0 
          ? (orgLanguages[languageIndex] || { langCode: 'en' })
          : (orgLanguages[0] || { langCode: 'en' });
      }
    } catch (err) {
      defaultLanguage = { langCode: 'en' };
    }
    
    // Find default date format (MM.dd.yyyy) or first format - safe array operations
    let defaultDateFormat = 'MM.dd.yyyy';
    try {
      if (orgDateFormat.length > 0) {
        const dateFormatIndex = orgDateFormat.findIndex((fmt: any) => 
          typeof fmt === 'string' && fmt === 'MM.dd.yyyy'
        );
        defaultDateFormat = dateFormatIndex >= 0 
          ? (orgDateFormat[dateFormatIndex] || 'MM.dd.yyyy')
          : (typeof orgDateFormat[0] === 'string' ? orgDateFormat[0] : 'MM.dd.yyyy');
      }
    } catch (err) {
      defaultDateFormat = 'MM.dd.yyyy';
    }

    // Extract communication settings - check if key exists in user object, fallback to org defaults
    const commSettings = {
      sms: userKeys.includes('sms') ? user.sms : (orgNotifications.sms !== undefined ? orgNotifications.sms : true),
      chat_with_push: userKeys.includes('chat_with_push') ? user.chat_with_push : (orgNotifications.chat_with_push !== undefined ? orgNotifications.chat_with_push : true),
      email: userKeys.includes('email') ? user.email : (orgNotifications.email !== undefined ? orgNotifications.email : true),
      push: userKeys.includes('push') ? user.push : (orgNotifications.push !== undefined ? orgNotifications.push : true),
      chat: userKeys.includes('chat') ? user.chat : (orgNotifications.chat !== undefined ? orgNotifications.chat : false),
    };

    // Extract units using getUserUnits logic
    const preferredUnits: Record<string, string> = {
      bloodPressureUnit: 'mmHg',
      glucometerUnit: 'mmol/L',
      heartBeatUnit: 'bpm',
      heightUnit: 'cm',
      oximeterUnit: 'SpO2',
      temperatureUnit: 'C',
      weightUnit: 'kg',
      cholesterolUnit: 'mg/dL',
      water: 'l',
      distance: 'km',
    };

    // Safe units extraction (match legacy getUserUnits: sign_up/get_user_profile/dynamodb.js)
    const orgUnitsKeys = (orgUnits && typeof orgUnits === 'object') ? Object.keys(orgUnits) : [];
    const userUnits: Record<string, string> = {};
    try {
      for (const key of orgUnitsKeys) {
        if (typeof key !== 'string') continue;
        const defaultUnitArray = orgUnits[key];
        const preferredUnit = preferredUnits[key];
        if (Array.isArray(defaultUnitArray) && defaultUnitArray.length > 0) {
          const defaultUnit =
            typeof preferredUnit === 'string' && defaultUnitArray.includes(preferredUnit)
              ? preferredUnit
              : (typeof defaultUnitArray[0] === 'string' ? defaultUnitArray[0] : preferredUnit || '');
          userUnits[key] = (typeof user[key] === 'string' && user[key]) || defaultUnit;
        }
      }
    } catch (err) {
      // Continue with defaults if unit extraction fails
    }
    // Legacy returns only keys defined in org's units config (can be {} when org has no units)
    const units = userUnits;

    // Determine userType - prefer DB userType (source of truth), then userCat, then roleType/request param
    let finalUserType = 'USER'; // Default
    try {
      const dbUserType = (user.userType && typeof user.userType === 'string' && user.userType.trim()) ? user.userType.trim() : '';
      if (dbUserType) {
        finalUserType = dbUserType;
      } else if (user.userCat && Array.isArray(user.userCat) && user.userCat.length > 0) {
        finalUserType = typeof user.userCat[0] === 'string' ? user.userCat[0] : 'USER';
      } else {
        // roleType will be set from role service later, but for now use provided userType
        const roleTypeStr = (user.roleType && typeof user.roleType === 'string') ? user.roleType : '';
        if (roleTypeStr) {
          if (roleTypeStr.includes('USER')) {
            finalUserType = 'USER';
          } else if (roleTypeStr.includes('STAFF')) {
            finalUserType = 'STAFF';
          } else {
            finalUserType = (userType && typeof userType === 'string') ? userType : 'USER';
          }
        } else {
          finalUserType = (userType && typeof userType === 'string') ? userType : 'USER';
        }
      }
    } catch (err) {
      finalUserType = (userType && typeof userType === 'string') ? userType : 'USER';
    }

    // Build full name with prefix if applicable - safe string operations
    let fullName = (user.fullName && typeof user.fullName === 'string') ? user.fullName : '';
    try {
      if (user.namePrefix && typeof user.namePrefix === 'string' && user.namePrefix.includes('Dr')) {
        fullName = `${user.namePrefix} ${fullName}`.trim();
      }
    } catch (err) {
      // Keep original fullName if prefix processing fails
    }

    // Fitness apps - check if key exists in user object
    const fitnessApps = {
      garmin: userKeys.includes('garmin') ? (user.garmin === true) : false,
      fitbit: userKeys.includes('fitbit') ? (user.fitbit === true) : false,
    };

    // Fetch all required data in parallel (with error handling)
    const userId = this.safeString(user.userID);
    const countryCode = this.safeString(user.countryCode) || (orgInfo?.address?.countryCode ? this.safeString(orgInfo.address.countryCode) : '');

    // Extract user roles directly from user object (userRole array)
    const userRoles: string[] = Array.isArray(user.userRole) ? user.userRole.filter((r: any) => typeof r === 'string' && r.trim() !== '') : [];
    const roleId = userRoles.length > 0 ? userRoles[0] : '';

    // Fetch role permissions for all user roles in parallel
    const rolePermissionsPromises = userRoles.map((rId: string) => 
      this.repository.getRolePermissions(rId, safeOrgId)
    );

    // Fetch data in parallel where possible
    const [
      rolePermissionsResults,
      currencies,
      userPreferences,
      fnfUserDetails,
    ] = await Promise.allSettled([
      // Get role permissions for all user roles
      Promise.allSettled(rolePermissionsPromises),
      // Get currencies for country code
      countryCode ? this.repository.getCurrenciesForCountryCode(countryCode) : Promise.resolve([]),
      // Get user preferences for schedule configuration
      this.repository.getUserPreferences(userId, safeOrgId),
      // Get FNF details if defaultProfile is set
      defaultProfile && defaultProfile.trim() !== '' ? this.repository.getUserBasicDetails(defaultProfile) : Promise.resolve(null),
    ]);

    // Extract roles and permissions data
    let roleName = '';
    let roleType = '';
    let permission: any = {};
    let userPermissions: any[] = [];
    let isDefault = false;

    // Process role permissions results
    if (rolePermissionsResults.status === 'fulfilled' && rolePermissionsResults.value) {
      const allRolePermissions: any[] = [];
      const roleDetailsArray = rolePermissionsResults.value;

      // Process first role for roleName, roleType, userPermissions, isDefault
      if (roleId && roleDetailsArray.length > 0 && roleDetailsArray[0].status === 'fulfilled') {
        const firstRoleDetails = roleDetailsArray[0].value;
        if (firstRoleDetails && firstRoleDetails.length > 0) {
          const roleDetail = firstRoleDetails[0];
          roleName = roleDetail?.roleName || roleDetail?.definedRoleCode || '';
          roleType = roleDetail?.roleType || '';
          userPermissions = roleDetail?.features || [];
          isDefault = roleDetail?.isDefault ?? false;
        }
      }

      // Collect permissions from all roles
      for (const roleResult of roleDetailsArray) {
        if (roleResult.status === 'fulfilled' && roleResult.value) {
          const roleDetails = roleResult.value;
          if (roleDetails && roleDetails.length > 0 && roleDetails[0].permissions) {
            allRolePermissions.push(roleDetails[0].permissions);
          }
        }
      }

      // Merge permissions from all roles
      if (allRolePermissions.length > 0) {
        permission = this.getUniquePermissions(allRolePermissions);
      }
    }

    // Extract currencies
    const currenciesArray = currencies.status === 'fulfilled' ? (currencies.value || []) : [];

    // Extract schedule configuration
    const scheduleConfiguration = userPreferences.status === 'fulfilled' ? (userPreferences.value || {}) : {};

    // Extract FNF details
    let fnfDetails: any = null;
    if (fnfUserDetails.status === 'fulfilled' && fnfUserDetails.value) {
      const fnfUser = fnfUserDetails.value;
      fnfDetails = {
        userID: defaultProfile || '',
        firstName: this.safeString(fnfUser.firstName),
        middleName: this.safeString(fnfUser.middleName),
        lastName: this.safeString(fnfUser.lastName),
        emailAddress: this.safeString(fnfUser.emailAddress),
        phoneNumber: this.safeString(fnfUser.phoneNumber),
        profilePic: this.safeString(fnfUser.profilePic),
        organizationID: this.safeString(fnfUser.organizationID),
        fullName: this.safeString(fnfUser.fullName),
        gender: this.safeString(fnfUser.gender),
        permissions: permission, // Use readonly permissions if needed (can be enhanced later)
      };
    }

    // Transform to match expected response structure - all string fields use safeString
    return {
      userCat: Array.isArray(user.userCat) ? user.userCat : [],
      userID: this.safeString(user.userID),
      emailVerified: this.safeBoolean(user.emailVerified),
      phoneVerified: this.safeBoolean(user.phoneVerified),
      firstName: this.safeString(user.firstName),
      middleName: this.safeString(user.middleName),
      lastName: this.safeString(user.lastName),
      mrn: this.safeString(user.mrn),
      emailAddress: this.safeString(user.emailAddress),
      phoneNumber: this.safeString(user.phoneNumber),
      profilePic: this.safeString(user.profilePic),
      organizationID: this.safeString(user.organizationID) || safeOrgId,
      fullName: this.safeString(fullName),
      gender: this.safeString(user.gender),
      weightInLbs: this.safeString(user.weightInLbs),
      weightInKG: this.safeString(user.weightInKG),
      heightInCm: this.safeString(user.heightInCm),
      heightInFeet: this.safeString(user.heightInFeet),
      cloudOpt: this.safeString(user.cloudOpt),
      country: this.safeString(user.country),
      language: userKeys.includes('language') ? this.safeString(user.language) : this.safeString(defaultLanguage?.langCode || 'en'),
      dateOfBirth: this.safeString(user.dateOfBirth),
      address: this.safeString(user.address),
      allergies: Array.isArray(allergies) ? allergies : [],
      chiefMedicalIssue: this.safeString(chiefMedicalIssue),
      smoking: this.safeString(smoking),
      alcoholConsumption: this.safeString(alcoholConsumption),
      additionalPhoneNumbers: Array.isArray(user.additionalPhoneNumbers) ? user.additionalPhoneNumbers : [],
      additionalEmailIDs: Array.isArray(user.additionalEmailIDs) ? user.additionalEmailIDs : [],
      srcRegisEntity: this.safeString(user.srcRegisEntity),
      accountAge: accountAge || { years: 0, months: 0, days: 0 },
      isRegisteredCompletely: this.safeBoolean(user.isRegisteredCompletely),
      appName: this.safeString(user.appName),
      accountStatus: this.safeString(user.accountStatus),
      phoneLocale: this.safeString(user.phoneLocale),
      locale: this.safeString(user.locale),
      userTimeZone: this.safeString(user.userTimeZone),
      stateCode: this.safeString(user.stateCode),
      countryCode: this.safeString(user.countryCode),
      currencies: currenciesArray,
      region: this.safeString(user.region),
      pushToken: this.safeString(user.pushToken),
      platform: this.safeString(user.platform),
      voipToken: this.safeString(user.voipToken),
      assignRoomNo: this.safeString(user.assignRoomNo),
      organizationName: this.safeString(orgInfo?.organizationName || orgData?.name),
      organizationAddress: (orgInfo && typeof orgInfo === 'object' && orgInfo.address && typeof orgInfo.address === 'object')
        ? orgInfo.address
        : {},
      organizationEmailAddress: (() => {
        try {
          if (orgData && typeof orgData === 'object' && Array.isArray(orgData.adminDetails) && orgData.adminDetails.length > 0) {
            const adminEmail = orgData.adminDetails[0]?.emailAddress;
            if (typeof adminEmail === 'string' && adminEmail) return adminEmail;
          }
          const orgEmail = orgInfo?.emailAddress;
          return (typeof orgEmail === 'string' && orgEmail) ? orgEmail : '';
        } catch (err) {
          return '';
        }
      })(),
      scheduleConfiguration: scheduleConfiguration,
      roleName: roleName,
      userRoles: userRoles,
      roleType: roleType,
      roleId: roleId,
      permission: permission,
      changePassword: this.safeBoolean(user.changePassword),
      isRpmUser: this.safeBoolean(user.isRpmUser),
      lastAppointment: this.safeString(user.lastAppointment),
      state: this.safeString(user.state),
      city: this.safeString(user.city),
      street: this.safeString(user.street),
      isActive: user.isActive !== undefined ? this.safeBoolean(user.isActive) : false,
      emergencyContact: (user.emergencyContact && typeof user.emergencyContact === 'object') ? user.emergencyContact : {},
      insuranceDetails: (user.insuranceDetails && typeof user.insuranceDetails === 'object') ? user.insuranceDetails : {},
      medicalHistory: (user.medicalHistory && typeof user.medicalHistory === 'object') ? user.medicalHistory : {},
      namePrefix: this.safeString(user.namePrefix),
      mfaEnabled: this.safeBoolean(user.mfaEnabled),
      phoneCode: this.safeString(user.phoneCode),
      zip: this.safeString(user.zip || user.postalCode),
      specialty: this.safeString(user.specialty),
      position: this.safeString(user.position),
      licenseNumber: this.safeString(user.licenseNumber),
      department: this.safeString(user.department),
      workSchedule: (user.workSchedule && typeof user.workSchedule === 'object') ? user.workSchedule : {},
      isDeleted: this.safeBoolean(user.isDeleted),
      delete_request_time: this.safeString(user.delete_request_time),
      ethnicity: this.safeString(user.ethnicity),
      maritalStatus: this.safeString(user.maritalStatus),
      bloodGroup: this.safeString(user.bloodGroup),
      appleHealthLastSync: this.safeString(user.appleHealthLastSync),
      googleFitLastSync: this.safeString(user.googleFitLastSync),
      experienceInYears: this.safeString(user.experienceInYears),
      bio: this.safeString(user.bio),
      workingHours: (user.workingHours && typeof user.workingHours === 'object') ? user.workingHours : {},
      userType: finalUserType,
      fnfDetails: fnfDetails,
      generalSettings: generalSettings,
      communicationSettings: commSettings,
      tabBar: orgTabBar,
      dateFormat: userKeys.includes('dateFormat') ? this.safeString(user.dateFormat) : this.safeString(defaultDateFormat),
      acceptedAppForms: Array.isArray(user.acceptedAppForms) ? user.acceptedAppForms : [],
      units: units,
      fitnessApps: fitnessApps,
      isTaskCompleted: user.isTaskCompleted !== undefined ? this.safeBoolean(user.isTaskCompleted) : true,
      userPermissions: userPermissions,
      isDefault: isDefault,
      definedRoleCode: this.safeString(user.definedRoleCode),
      // Additional fields that may exist
      reporterId: this.safeString(user.reporterId),
      reporterProfilePic: this.safeString(user.reporterProfilePic),
      reporterSpecialty: this.safeString(user.reporterSpecialty),
      reporterName: this.safeString(user.reporterName),
      referred: this.safeString(user.referred),
      careManager: this.safeString(user.careManager),
      dietician: this.safeString(user.dietician),
      healthCoach: this.safeString(user.healthCoach),
    };
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

      // Construct fullName if firstName or lastName is being updated
      if (updates.firstName !== undefined || updates.lastName !== undefined) {
        const firstName = updates.firstName !== undefined 
          ? String(updates.firstName).trim() 
          : String(existing.firstName || '').trim();
        const lastName = updates.lastName !== undefined 
          ? String(updates.lastName).trim() 
          : String(existing.lastName || '').trim();
        updates.fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
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
      updates.generalSetting = updates.generalSetting ?? existing.generalSetting;
       console.log("UPDATES: ", JSON.stringify(updates));
      await this.repository.updateUser(userId, organizationId, updates);
      const updated = await this.repository.getUser(userId, organizationId);
      if (!updated) {
        throw new UserNotFoundError(userId);
      }

      // Best-effort email + SMS (same event path as createUser → SNS → notification consumer)
      try {
        const phoneRaw =
          (updated.phoneNumber && String(updated.phoneNumber).trim()) ||
          (updates.phoneNumber !== undefined && String(updates.phoneNumber).trim()) ||
          '';
        const phoneCodeRaw = String(
          updated.phoneCode ||
            (updates.phoneCode !== undefined ? String(updates.phoneCode).trim() : '') ||
            '',
        ).trim();
        let notifyPhone: string | undefined;
        if (phoneRaw) {
          if (phoneCodeRaw) {
            notifyPhone = phoneCodeRaw.startsWith('+')
              ? `${phoneCodeRaw}${phoneRaw}`
              : `+${phoneCodeRaw}${phoneRaw}`;
          } else {
            notifyPhone = phoneRaw.startsWith('+') ? phoneRaw : `+${phoneRaw}`;
          }
        }
        const notifyEmail = String(updated.emailAddress || '').trim();
        const profileChannels: string[] = [];
        if (notifyPhone) profileChannels.push('sms');
        if (notifyEmail) profileChannels.push('email');
        if (profileChannels.length > 0) {
          const notifyName =
            (updates.fullName as string | undefined) ??
            updated.fullName ??
            updated.firstName ??
            '';
          await notifyUser({
            userId: updated.userID,
            email: notifyEmail || undefined,
            phone: notifyPhone,
            name: notifyName,
            channels: profileChannels,
            template: 'PROFILE_UPDATED',
            // PROFILE_UPDATED template in template.registry has no {{placeholders}}; empty is valid.
            templateData: {},
            correlationId,
          });
        } else {
          logger.info({
            event: 'service_updateUser_notification_skipped',
            message:
              'PROFILE_UPDATED skipped: no phone and no email on user or request',
          });
        }
      } catch (notifyErr) {
        logger.warn({
          event: 'service_updateUser_notification_failed',
          err: serializeError(notifyErr as Error),
        });
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

  async updateRecentInvite(
userId: string, organizationId: string, patientId: string, options: { email?: boolean; sms?: boolean; }, correlationId?: string,
  ): Promise<{
    email: boolean;
    emailUpdatedAt: string;
    sms: boolean;
    smsUpdatedAt: string;
  }> {
    const timer = createPerformanceTimer(baseLogger, 'updateRecentInvite', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, userId, organizationId, patientId });
    logger.info({ event: 'service_updateRecentInvite_start', options });

    try {
      // Verify user exists
      console.log("PATIENT ID : ",patientId)
      const existing = await this.repository.getUser(patientId, organizationId);
      console.log("EXISTING : ",existing)
      if (!existing) {
        throw new UserNotFoundError(patientId);
      }

      const result = await this.repository.updateRecentInvite(patientId, organizationId, options);
      timer.end();
      logger.info({ event: 'service_updateRecentInvite_success', result });
      return result;
    } catch (err) {
      logger.error({ event: 'service_updateRecentInvite_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async activateDeactivateUser(
    organizationId: string,
    targetUserId: string,
    action: 'ACTIVATE' | 'DEACTIVATE',
    correlationId?: string,
  ): Promise<void> {
    const timer = createPerformanceTimer(baseLogger, 'activateDeactivateUser', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId, targetUserId, action });

    try {
      const existing = await this.repository.getUser(targetUserId, organizationId);
      if (!existing) {
        throw new UserNotFoundError(targetUserId);
      }

      const isActive = action === 'ACTIVATE';
      await this.repository.updateUser(targetUserId, organizationId, { isActive, modifiedDate: Date.now() });

      if (action === 'DEACTIVATE') {
        try {
          const userTypeUpper = String(existing.userType || '').toUpperCase();
          const isStaffLike = userTypeUpper === 'STAFF' || userTypeUpper === 'ADMIN';
          const phoneRaw = String(existing.phoneNumber || '').trim();
          const phoneCodeRaw = String(existing.phoneCode || '').trim();
          let notifyPhone: string | undefined;
          if (phoneRaw && isStaffLike) {
            if (phoneCodeRaw) {
              notifyPhone = phoneCodeRaw.startsWith('+')
                ? `${phoneCodeRaw}${phoneRaw}`
                : `+${phoneCodeRaw}${phoneRaw}`;
            } else {
              notifyPhone = phoneRaw.startsWith('+') ? phoneRaw : `+${phoneRaw}`;
            }
          }
          if (notifyPhone) {
            const orgDetails = await this.organizationRepository.getOrganizationFromDB(organizationId);
            const organizationName =
              (orgDetails as any)?.name ||
              (orgDetails as any)?.organizationInfo?.organizationName ||
              (orgDetails as any)?.organizationInfo?.name ||
              '';
            await notifyUser({
              userId: existing.userID,
              phone: notifyPhone,
              channels: ['sms'],
              template: 'STAFF_DEACTIVATED',
              templateData: { ORG_NAME: organizationName },
              correlationId,
            });
          } else {
            logger.info({
              event: 'service_activateDeactivateUser_sms_skipped',
              reason: !isStaffLike ? 'not_staff_or_admin' : 'no_phone',
            });
          }
        } catch (notifyErr) {
          logger.warn({
            event: 'service_activateDeactivateUser_notification_failed',
            err: serializeError(notifyErr as Error),
          });
        }
      }

      logger.info({ event: 'service_activateDeactivateUser_success' });
      timer.end();
    } catch (err) {
      logger.error({ event: 'service_activateDeactivateUser_error', err: serializeError(err) });
      timer.end();
      throw err;
    }
  }

  async getOrganizationUserCounts(
    organizationId: string,
    filters?: { roleId?: string; roleName?: string; roleType?: string; status?: string },
    correlationId?: string,
  ): Promise<Array<Record<string, unknown>>> {
    const timer = createPerformanceTimer(baseLogger, 'getOrganizationUserCounts', correlationId);
    const logger = createChildLogger(baseLogger, { correlationId, organizationId });

    try {
      const items = await this.repository.getOrganizationUserCounts(organizationId, filters);
      logger.info({ event: 'service_getOrganizationUserCounts_success', count: items.length });
      timer.end();
      return items;
    } catch (err) {
      logger.error({ event: 'service_getOrganizationUserCounts_error', err: serializeError(err) });
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

  /**
   * Assign a patient (receiver) to a doctor (sender) in an organization.
   * Uses the same table pattern as legacy link_unlink_user:
   * - Link record: pk=USER#doctorId, sk=ASSIGNEE#patientId, sk1=ACTIVE
   * - Patient record: reporterId, reporterName, reporterProfilePic, reporterEmail
   */
  async assignDoctor(
    organizationId: string,
    sender: { userId: string; name?: string; email?: string },
    receiver: { userId: string; name?: string; email?: string },
    correlationId?: string,
    isReferred?: boolean,
  ): Promise<void> {
    const timer = createPerformanceTimer(baseLogger, 'assignDoctor', correlationId);
    const logger = createChildLogger(baseLogger, { organizationId, doctorId: sender.userId, patientId: receiver.userId });
    logger.info({ event: 'service_assignDoctor_start' });

    const doctor = await this.repository.getUser(sender.userId, organizationId);
    if (!doctor) {
      timer.end();
      throw new UserNotFoundError(sender.userId);
    }
    const patient = await this.repository.getUser(receiver.userId, organizationId);
    if (!patient) {
      timer.end();
      throw new UserNotFoundError(receiver.userId);
    }

    const doctorFullName =
      (doctor as any).namePrefix && String((doctor as any).namePrefix).toLowerCase().includes('dr')
        ? `${(doctor as any).namePrefix} ${(doctor as any).fullName || (doctor as any).firstName || ''}`.trim()
        : (doctor as any).fullName || (doctor as any).firstName || (sender as any).name || sender.userId;

    await this.repository.saveDoctorPatientLink(sender.userId, receiver.userId, organizationId);
    if(!isReferred){
    await this.repository.updatePatientReporter(receiver.userId, organizationId, {
      reporterId: sender.userId,
      reporterName: doctorFullName,
      reporterProfilePic: (doctor as any).profilePic,
      reporterEmail: (doctor as any).emailAddress ?? sender.email,
    });
  }

    logger.info({ event: 'service_assignDoctor_success' });
    timer.end();
  }

  /**
   * List all patients assigned to a doctor in an organization.
   * Uses legacy link records (USER#doctorId / ASSIGNEE#patientId, SCD_LINK#patientId).
   */
  async listDoctorPatients(doctorId: string, organizationId: string): Promise<Record<string, unknown>[]> {
    const timer = createPerformanceTimer(baseLogger, 'listDoctorPatients');
    const logger = createChildLogger(baseLogger, { doctorId, organizationId });
    logger.info({ event: 'service_listDoctorPatients_start' });

    const links = await this.repository.listPatientIdsForDoctor(doctorId);
    if (links.length === 0) {
      timer.end();
      return [];
    }

    const doctor = await this.repository.getUser(doctorId, organizationId);
    console.log("DOCTOR: ", doctor);
    const doctorName = doctor
      ? `${(doctor as any).namePrefix || ''} ${(doctor as any).fullName || (doctor as any).firstName || ''}`.trim()
      : '';

    const users: Record<string, unknown>[] = [];
    for (const { patientId, patientOrgId, previouslyConsulted } of links) {
      const orgId = patientOrgId || organizationId;
      const user = await this.repository.getUser(patientId, orgId);
      if (!user) continue;
      console.log("USER: ", user);
      const u = user as unknown as Record<string, unknown>;
      users.push({
        city: u.city || '',
        state: u.state || '',
        country: u.country || '',
        fullName: u.fullName || '',
        emailAddress: u.emailAddress || '',
        phoneNumber: u.phoneNumber || '',
        lastAppointment: (u as any).lastAppointment ?? null,
        profilePic: u.profilePic || '',
        reporterId: u.reporterId || '',
        doctor: doctorName || (u.reporterName as string) || '',
        patientId: u.userID || patientId,
        userID: u.userID || patientId,
        accountType: (u as any).isRpmUser ? 'RPM' : 'REGULAR',
        status: (u as any).isActive !== false ? 'active' : 'inactive',
        createdDate: u.createdDate ?? u.createdAt ?? null,
        mrn: u.mrn ?? null,
        gender: u.gender || '',
        medicalHistory: (u as any).medicalHistory ?? null,
        dateOfBirth: u.dateOfBirth ?? null,
        patientOrgId: u.organizationID || orgId,
        previouslyConsulted: previouslyConsulted ?? false,
      });
    }

    logger.info({ event: 'service_listDoctorPatients_success', count: users.length });
    timer.end();
    return users;
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
  ): Promise<UserResponse[]> {
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
    patientId: string,
    organizationId: string,
    requestingUserId?: string,
    defaultProfile?: string,
    userType?: string,
    authHeader?: string,
  ): Promise<any> {
    const timer = createPerformanceTimer(baseLogger, 'getUserWithOrganizationDetails');
    const logger = createChildLogger(baseLogger, { patientId, organizationId, requestingUserId });
    logger.info({ event: 'service_getUserWithOrganizationDetails_start' });

    try {
      // Handle default profile (family member access)
      let actualUserId = patientId;
      let fnfDetails: User | null = null;

      if (defaultProfile && defaultProfile !== '') {
        actualUserId = defaultProfile;
        fnfDetails = await this.repository.getUser(patientId, organizationId);
      }

      // First, try to get the user using the organizationId (new schema: pk=ORG#orgId, sk=USER#userId)
      let userBasicDetails = await this.repository.getUser(actualUserId, organizationId);
        if (!userBasicDetails) {
        userBasicDetails = await this.repository.getUser(actualUserId);
      }

      if (!userBasicDetails) {
        throw new UserNotFoundError(actualUserId);
      }

      // Get organization details (matches original: getOrgBasicDetails from USER_TABLE)
      let orgBasicDetails: any = null;
      // Prefer organizationId from the request when provided; fall back to user's stored organizationID
      const userOrgId = (organizationId && organizationId.trim() !== '')
        ? organizationId
        : userBasicDetails.organizationID;
      if (userOrgId && userOrgId !== 'ROOT') {
        // First try getOrgBasicDetails from USER_TABLE (matches original flow)
        orgBasicDetails = await this.organizationRepository.getOrgBasicDetails(userOrgId);
        // Fallback to getOrganizationFromDB if not found
        if (!orgBasicDetails) {
          orgBasicDetails = await this.organizationRepository.getOrganizationFromDB(userOrgId);
        }
        // Final fallback to Organization API if not found in DB
        if (!orgBasicDetails) {
          orgBasicDetails = await getOrganizationViaApi(userOrgId, authHeader);
        }
        
        logger.debug({
          event: 'org_details_fetched',
          userOrgId,
          hasOrgBasicDetails: !!orgBasicDetails,
          orgStructure: orgBasicDetails ? {
            hasOrganizationInfo: !!orgBasicDetails.organizationInfo,
            hasAdminDetails: !!orgBasicDetails.adminDetails,
            organizationInfoKeys: orgBasicDetails.organizationInfo ? Object.keys(orgBasicDetails.organizationInfo) : [],
          } : null,
        });
      }

      // Get all related user data items (preferences, metadata, etc.) using pk=USER#userId
      const allUserData = await this.repository.getAllUserData(actualUserId);
      
      // Check if definedRoleCode exists in any item in allUserData
      const itemWithDefinedRoleCode = allUserData.find((item: any) => item.definedRoleCode);
      const itemRoleId =
        allUserData.find(item => item.userRole?.[0])?.userRole[0] ?? '';

      
      // Find preference details from allUserData
      const preferenceDetails = allUserData.find((item: any) => 
        item.sk?.includes('PREFERENCE') || item.sk === 'PREFERENCE' || item.sk?.startsWith('PREFERENCE')
      );

      // Get roles and permissions (matches original flow exactly)
      // Step 1: Get user roles from USER_TABLE using getUserRolesPermissions
      // This provides the mapping between user and roles (USER_TABLE → ROLES_TABLE mapping)
      // const permissionResponse = await this.repository.getUserRolesPermissions(actualUserId, userOrgId, authHeader);
      // const filteredRoles = permissionResponse.roles || [];
      // console.log("USER DATA 1336 PERMISSION RESPONSE: ", permissionResponse);
       let roleDetails: any[] = [];
       let roleName = '';
      // Use userPermissions from API response if available, otherwise will be set from ROLES_TABLE
      let userPermissions: any[] = [];
      let isDefault = false;
      let definedRoleCode: string | null = null;
      let roleType: string | null = null;
      let roleId: string | null = null;
      let uniquePermissions: any = {};

      definedRoleCode = itemWithDefinedRoleCode ? itemWithDefinedRoleCode.definedRoleCode : null;

      // Step 2: If roles found, get role details from ROLES_TABLE (matches original: getRolePermissions)
      // The original code uses getRolePermissions from ROLES_TABLE to get features array
      if (itemRoleId) {
        // roleId = filteredRoles[0];
        logger.debug({ event: 'fetching_role_permissions_from_roles_table', roleId, userOrgId });
         
 
        const orgFetaures = await packageRepository.getOrgFeatures(userOrgId, authHeader);
        const rolePermissionsFromRolesTable = await roleRepository.getUserPermission(userOrgId, actualUserId,orgFetaures, authHeader);
        
        logger.debug({ 
          event: 'role_permissions_from_roles_table_result', 
          roleId, 
          userOrgId,
          rolePermissionsCount: rolePermissionsFromRolesTable?.length || 0,
        });
        
        if (rolePermissionsFromRolesTable && rolePermissionsFromRolesTable.length > 0) {
          const roleItems = rolePermissionsFromRolesTable;

          // Match original: index.js line 115-119
          // const roleDetails = await DB.getRolePermissions(filteredRoles[0], organizationID);
          // const definedRoleCode = orgFeaturesroleDetails[0]?.definedRoleCode ?? null;
          // The original just takes the first item from getRolePermissions result
          const roleDetailsFirstItem = roleItems[0];

          // Try to find a role header item (SK === ROLE#roleId or starts with ROLE#roleId)
          // If not found, use first item (matches original behavior)
            const roleHeader =
            roleItems.find((it: any) => {
              const sk = String(it.SK || it.sk || '');
              return sk === `ROLE#${roleId}` || sk.startsWith(`ROLE#${roleId}#`);
            }) || roleDetailsFirstItem;

            console.log("roleHeader: ");
          // Extract fields - match original: index.js line 116-120
          roleName = roleHeader?.roleName || roleHeader?.definedRoleCode || roleDetailsFirstItem?.roleName || roleDetailsFirstItem?.definedRoleCode || '';
          isDefault = roleHeader?.isDefault ?? roleDetailsFirstItem?.isDefault ?? false;
          // Prioritize definedRoleCode from USER_TABLE (userBasicDetails or allUserData) first, then ROLES_TABLE
          const definedRoleCodeFromUserTable = (userBasicDetails as any).definedRoleCode ?? 
            (allUserData.find((item: any) => item.definedRoleCode) as any)?.definedRoleCode;
          definedRoleCode = definedRoleCodeFromUserTable ?? roleDetailsFirstItem?.definedRoleCode ?? roleHeader?.definedRoleCode ?? null;
          roleType = roleHeader?.roleType ?? roleDetailsFirstItem?.roleType ?? null;

          // Only set userPermissions from ROLES_TABLE if not already set from API
          if (!userPermissions || userPermissions.length === 0) {
            console.log("here")
            // console.log("ROLE DETAILS FIRST ITEM FEATURES: ", JSON.stringify(roleDetailsFirstItem?.features));
            const headerFeatures = roleDetailsFirstItem?.features;
            console.log("headerFeatures: ", JSON.stringify(headerFeatures));
            userPermissions = headerFeatures;
          }

          // Ensure userPermissions is always an array
          if (!Array.isArray(userPermissions)) userPermissions = [];

          logger.info({
            event: 'role_permissions_fetched_from_roles_table',
            roleId,
            roleItemsCount: roleItems.length,
            userPermissionsCount: userPermissions.length,
            userPermissionsSource: userPermissions.length > 0 
              ? 'ROLES_TABLE'
              : 'empty',
            definedRoleCode,
            definedRoleCodeSource: roleHeader?.definedRoleCode ? 'roleHeader' : (userBasicDetails.definedRoleCode ? 'userBasicDetails' : 'null'),
            roleName,
            roleType,
          });
        } else {
          // Fallback: try to get from USER_TABLE if not found in ROLES_TABLE
          logger.debug({ event: 'fallback_to_user_table_role_details', roleId, userOrgId });
          roleDetails = await this.repository.getRoleDetails(userOrgId, itemRoleId);
          
          if (roleDetails && roleDetails.length > 0) {
            const roleDetail = roleDetails[0];
            roleName = roleDetail.roleName || roleDetail.definedRoleCode || '';
            // Try to get features from USER_TABLE role details
            const featuresFromUserTable = roleDetail.features;
            if (featuresFromUserTable) {
              userPermissions = Array.isArray(featuresFromUserTable) ? featuresFromUserTable :
                               (typeof featuresFromUserTable === 'object' ? Object.values(featuresFromUserTable) : []);
            } else {
              userPermissions = [];
            }
            isDefault = roleDetail.isDefault ?? false;
            // Prioritize definedRoleCode from USER_TABLE (userBasicDetails or allUserData) first, then role detail
            const definedRoleCodeFromUserTable = (userBasicDetails as any).definedRoleCode ?? 
              (allUserData.find((item: any) => item.definedRoleCode) as any)?.definedRoleCode;
            definedRoleCode = definedRoleCodeFromUserTable ?? roleDetail.definedRoleCode ?? null;
            roleType = roleDetail.roleType ?? null;
            
            logger.debug({
              event: 'definedRoleCode_from_user_table_fallback',
              roleId,
              definedRoleCode,
              definedRoleCodeSource: roleDetail.definedRoleCode ? 'roleDetail' : (userBasicDetails.definedRoleCode ? 'userBasicDetails' : 'null'),
            });
          } else {
            // If no role details found, get definedRoleCode from userBasicDetails or allUserData (USER_TABLE)
            const definedRoleCodeFromUserTable = (userBasicDetails as any).definedRoleCode ?? 
              (allUserData.find((item: any) => item.definedRoleCode) as any)?.definedRoleCode;
            definedRoleCode = definedRoleCodeFromUserTable ?? null;
            logger.warn({ 
              event: 'role_details_not_found', 
              roleId, 
              userOrgId,
              triedRolesTable: true,
              triedUserTable: true,
              definedRoleCodeFromUserBasic: userBasicDetails.definedRoleCode ?? null,
            });
          }
        }
      } else {
        // Fallback: try to use roleID from userBasicDetails
        const userRoleId = (userBasicDetails as any).roleID || (userBasicDetails as any).roleId;
        if (userRoleId) {
          roleId = userRoleId;
          logger.debug({ event: 'using_role_from_user_basic_details', roleId });
          if (roleId) {
            // Try ROLES_TABLE first
            const orgFetaures = await packageRepository.getOrgFeatures(userOrgId, authHeader);
            const rolePermissionsFromRolesTable = await roleRepository.getUserPermission(userOrgId, actualUserId,orgFetaures, authHeader);            if (rolePermissionsFromRolesTable && rolePermissionsFromRolesTable.length > 0) {
              const roleItems = rolePermissionsFromRolesTable;
              const roleHeader =
                roleItems.find((it: any) => String(it.SK || it.sk || '') === `ROLE#${roleId}`) ||
                roleItems.find((it: any) => String(it.SK || it.sk || '').startsWith(`ROLE#${roleId}`)) ||
                roleItems[0];

              roleName = roleHeader?.roleName || roleHeader?.definedRoleCode || '';
              isDefault = roleHeader?.isDefault ?? false;
              // Prioritize definedRoleCode from USER_TABLE (userBasicDetails or allUserData) first, then ROLES_TABLE
              const definedRoleCodeFromUserTable = (userBasicDetails as any).definedRoleCode ?? 
                (allUserData.find((item: any) => item.definedRoleCode) as any)?.definedRoleCode;
              definedRoleCode = definedRoleCodeFromUserTable ?? roleHeader?.definedRoleCode ?? null;
              roleType = roleHeader?.roleType ?? null;

              // console.log("ROLE HEADER FEATURES: ", roleHeader);
              const headerFeatures = roleHeader?.features;
              if (Array.isArray(headerFeatures) && headerFeatures.length > 0) {
                userPermissions = headerFeatures;
              } else if (headerFeatures && typeof headerFeatures === 'object') {
                userPermissions = Object.values(headerFeatures);
              } else {
                const featureItems = roleItems.filter((it: any) => {
                  const sk = String(it.SK || it.sk || '');
                  return (
                    it.itemType === 'Feature' ||
                    !!it.featureKey ||
                    sk.includes('#FEATURE#') ||
                    sk.startsWith('MODULE#')
                  );
                });
                userPermissions = featureItems;
              }

              if (!Array.isArray(userPermissions)) userPermissions = [];
            } else {
              // Fallback to USER_TABLE
              roleDetails = await this.repository.getRoleDetails(userOrgId, roleId);
              if (roleDetails && roleDetails.length > 0) {
                const roleDetail = roleDetails[0];
                roleName = roleDetail.roleName || roleDetail.definedRoleCode || '';
                const featuresFromUserTable = roleDetail.features;
                userPermissions = Array.isArray(featuresFromUserTable) ? featuresFromUserTable : 
                                 (typeof featuresFromUserTable === 'object' ? Object.values(featuresFromUserTable) : []);
                isDefault = roleDetail.isDefault ?? false;
                // Prioritize definedRoleCode from USER_TABLE (userBasicDetails or allUserData) first, then role detail
                const definedRoleCodeFromUserTable = (userBasicDetails as any).definedRoleCode ?? 
                  (allUserData.find((item: any) => item.definedRoleCode) as any)?.definedRoleCode;
                definedRoleCode = definedRoleCodeFromUserTable ?? roleDetail.definedRoleCode ?? null;
                roleType = roleDetail.roleType ?? null;
              }
            }
          }
        }
      }

      // Final fallback: If definedRoleCode is still null, get it from USER_TABLE
      if (!definedRoleCode) {
        const definedRoleCodeFromUserTableFinal = (userBasicDetails as any).definedRoleCode ?? 
          (allUserData.find((item: any) => item.definedRoleCode) as any)?.definedRoleCode;
        if (definedRoleCodeFromUserTableFinal) {
          definedRoleCode = definedRoleCodeFromUserTableFinal;
        }
      }

      // Step 3: Get unique permissions (matches original: line 122)
      // permissionResponse.permissions is an array of permission objects
      // if (permissionResponse.permissions && permissionResponse.permissions.length > 0) {
        uniquePermissions = this.getUniquePermissions(userPermissions);
      // }


      // Calculate account age
      const accountAge = this.calculateAccountAge(userBasicDetails.createdDate || Date.now());

      // Build schedule configuration from preferences
      let scheduleConfiguration: any = {};
      if (preferenceDetails) {
        const { pk, sk, userID, createdDate, modifiedDate, organizationID, ...rest } = preferenceDetails;
        scheduleConfiguration = { ...rest };
      }

      // Get user category: prefer DB userType (source of truth), then userCat, then request param, then default
      const userCategory =
        (userBasicDetails.userType && String(userBasicDetails.userType).trim()) ||
        userBasicDetails.userCat?.[0] ||
        userType ||
        'USER';

      // Get currencies (matches original: getCurrenciesForCountryCode)
      const currencies = await this.repository.getCurrenciesForCountryCode(
        userBasicDetails.countryCode || orgBasicDetails?.organizationInfo?.address?.countryCode || ''
      );

      console.log("USER General DETAILS: ", JSON.stringify(userBasicDetails?.generalSetting));

      // Resolve units from org defaultSetting and user overrides (match legacy getUserUnits: sign_up/get_user_profile/dynamodb.js)
      const orgDefaultSetting = orgBasicDetails?.organizationInfo?.defaultSetting
        ?? orgBasicDetails?.defaultSetting
        ?? {};
      const orgUnits = (orgDefaultSetting && typeof orgDefaultSetting === 'object' && orgDefaultSetting.units)
        ? orgDefaultSetting.units
        : {};
      const preferredUnits: Record<string, string> = {
        bloodPressureUnit: 'mmHg',
        glucometerUnit: 'mmol/L',
        heartBeatUnit: 'bpm',
        heightUnit: 'cm',
        oximeterUnit: 'SpO2',
        temperatureUnit: 'C',
        weightUnit: 'kg',
        cholesterolUnit: 'mg/dL',
        waterUnit: 'l',
        distanceUnit: 'km',
        caloriesUnit: 'kcal',
        speedUnit: 'km/h',
        powerUnit: 'W',
        physicalEffortUnit: 'METs',
      };
      const orgUnitsKeys = (orgUnits && typeof orgUnits === 'object') ? Object.keys(orgUnits) : [];
      const userUnits: Record<string, string> = {};
      try {
        const u = userBasicDetails as any;
        for (const key of orgUnitsKeys) {
          if (typeof key !== 'string') continue;
          const defaultUnitArray = orgUnits[key];
          const preferredUnit = preferredUnits[key];
          if (Array.isArray(defaultUnitArray) && defaultUnitArray.length > 0) {
            const defaultUnit =
              typeof preferredUnit === 'string' && defaultUnitArray.includes(preferredUnit)
                ? preferredUnit
                : (typeof defaultUnitArray[0] === 'string' ? defaultUnitArray[0] : preferredUnit || '');
            userUnits[key] = (typeof u[key] === 'string' && u[key]) || (u.unitsSettings?.[key]) || defaultUnit;
          }
        }
      } catch {
        // continue with defaults
      }

      // Ensure all standard unit keys are present in the response.
      // Prefer (in order): user.unitsSettings -> legacy top-level user field -> org default-derived value -> hardcoded preferred default.
      const units: Record<string, string> = {};
      const u = userBasicDetails as any;
      const unitKeys = Object.keys(preferredUnits);
      for (const key of unitKeys) {
        const fromUserSettings = (() => {
          const us = u?.unitsSettings;
          if (!us) return undefined;
          const direct =
            typeof us?.[key] === 'string' && us[key] ? us[key] : undefined;
          if (direct) return direct;
          // Accept legacy aliases stored in unitsSettings
          if (key === 'distanceUnit') {
            return typeof us?.distance === 'string' && us.distance ? us.distance : undefined;
          }
          if (key === 'waterUnit') {
            return typeof us?.water === 'string' && us.water ? us.water : undefined;
          }
          return undefined;
        })();
        const fromLegacyTopLevel =
          typeof u?.[key] === 'string' && u[key] ? u[key] : undefined;
        const fromOrgDerived =
          typeof userUnits[key] === 'string' && userUnits[key] ? userUnits[key] : undefined;
        units[key] = fromUserSettings ?? fromLegacyTopLevel ?? fromOrgDerived ?? preferredUnits[key];
      }

      // Backwards-compatible aliases in response payload
      units.distance = units.distanceUnit;
      units.water = units.waterUnit;

      // Get email/phone verification status (matches original: getEmailPhoneVerifiedStatus)
      let emailVerified = false;
      let phoneVerified = false;
      if (userBasicDetails) {
        try {
          const verifiedStatus = await this.getEmailPhoneVerifiedStatus(userBasicDetails, actualUserId, userOrgId);
          emailVerified = verifiedStatus?.emailVerified || false;
          phoneVerified = verifiedStatus?.phoneVerified || false;
        } catch (err) {
          logger.warn({ event: 'getEmailPhoneVerifiedStatus_error', err: serializeError(err) });
          // Fallback to DB values
          emailVerified = userBasicDetails.emailVerified || false;
          phoneVerified = userBasicDetails.phoneVerified || false;
        }
      }

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
        slotDurationInMinutes: userBasicDetails.slotDurationInMinutes || 15,
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
        organizationName: orgBasicDetails?.organizationInfo?.organizationName || 
                         orgBasicDetails?.organizationInfo?.name || 
                         orgBasicDetails?.name || 
                         '',
        organizationAddress: orgBasicDetails?.organizationInfo?.address || 
                            orgBasicDetails?.address || 
                            {},
        organizationEmailAddress: orgBasicDetails?.adminDetails?.emailAddress || 
                                 orgBasicDetails?.adminDetails?.email || 
                                 orgBasicDetails?.emailAddress || 
                                 '',
        organizationType: orgBasicDetails?.organizationType || orgBasicDetails?.organizationInfo?.organizationType || orgBasicDetails?.lsi_organizationType || (orgBasicDetails as any)?.orgType || (orgBasicDetails as any)?.type || '',
        scheduleConfiguration,
        roleName,
        userRoles: itemRoleId ? [itemRoleId] : [],
        roleType,
        roleId:itemRoleId,
        userPermissions,
        changePassword: userBasicDetails.changePassword || false,
        isRpmUser: userBasicDetails.isRpmUser || false,
        lastAppointment: userBasicDetails.lastAppointment || '',
        state: userBasicDetails.state || '',
        city: userBasicDetails.city || '',
        street: userBasicDetails.street || '',
        isActive: userBasicDetails.isActive || false,
        emergencyContact: userBasicDetails.emergencyContact || {},
        insuranceDetails: userBasicDetails.insuranceDetails || {},
        inviteDetails: userBasicDetails.inviteDetails || undefined,
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
        userCat: Array.isArray(userBasicDetails.userCat) ? userBasicDetails.userCat : (userBasicDetails.userCat ? [userBasicDetails.userCat] : []),
        fnfDetails: fnfDetails ? {
          userID: actualUserId,
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
        generalSettings: (() => {
          const gs = (userBasicDetails as any).generalSetting || {};
          return {
            promotions:
              gs.promotions ??
              ((userBasicDetails as any).promotions !== undefined
                ? (userBasicDetails as any).promotions
                : true),
            medication:
              gs.medication ??
              ((userBasicDetails as any).medication !== undefined
                ? (userBasicDetails as any).medication
                : true),
            appointment:
              gs.appointment ??
              ((userBasicDetails as any).appointment !== undefined
                ? (userBasicDetails as any).appointment
                : true),
            newsAndArticles:
              gs.newsAndArticles ??
              ((userBasicDetails as any).newsAndArticles !== undefined
                ? (userBasicDetails as any).newsAndArticles
                : true),
            emergencyVital:
              gs.emergencyVital ??
              ((userBasicDetails as any).emergencyVital !== undefined
                ? (userBasicDetails as any).emergencyVital
                : true),
            medicationReminders:
              gs.medicationReminders ??
              ((userBasicDetails as any).medicationReminders !== undefined
                ? (userBasicDetails as any).medicationReminders
                : true),
            appointmentReminders:
              gs.appointmentReminders ??
              ((userBasicDetails as any).appointmentReminders !== undefined
                ? (userBasicDetails as any).appointmentReminders
                : true),
            activityGoals:
              gs.activityGoals ??
              ((userBasicDetails as any).activityGoals !== undefined
                ? (userBasicDetails as any).activityGoals
                : true),
            healthCheckIn:
              gs.healthCheckIn ??
              ((userBasicDetails as any).healthCheckIn !== undefined
                ? (userBasicDetails as any).healthCheckIn
                : true),
            debugMode:
              gs.debugMode ??
              ((userBasicDetails as any).debugMode !== undefined
                ? (userBasicDetails as any).debugMode
                : false),
          };
        })(),
        communicationSettings: {
          sms: (userBasicDetails as any).sms !== undefined ? (userBasicDetails as any).sms : (orgBasicDetails?.organizationInfo?.defaultSetting?.notifications?.sms ?? true),
          chat_with_push: (userBasicDetails as any).chat_with_push !== undefined ? (userBasicDetails as any).chat_with_push : (orgBasicDetails?.organizationInfo?.defaultSetting?.notifications?.chat_with_push ?? true),
          email: (userBasicDetails as any).email !== undefined ? (userBasicDetails as any).email : (orgBasicDetails?.organizationInfo?.defaultSetting?.notifications?.email ?? true),
          push: (userBasicDetails as any).push !== undefined ? (userBasicDetails as any).push : (orgBasicDetails?.organizationInfo?.defaultSetting?.notifications?.push ?? true),
          chat: (userBasicDetails as any).chat !== undefined ? (userBasicDetails as any).chat : (orgBasicDetails?.organizationInfo?.defaultSetting?.notifications?.chat ?? false),
        },
        tabBar: orgBasicDetails?.organizationInfo?.defaultSetting?.tabBar || [],
        dateFormat: userBasicDetails.dateFormat || orgBasicDetails?.organizationInfo?.defaultSetting?.dateFormat?.[0] || 'MM/DD/YYYY',
        acceptedAppForms: userBasicDetails.acceptedAppForms || [],
        units,
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

      // Add all assigned doctors from ASSIGNEE# mapping (referenced array)
      const assignedDoctorLinks = await this.repository.listAssignedDoctorIdsForPatient(actualUserId);
      data.assignedDoctors = [];
      for (const link of assignedDoctorLinks) {
        const docDetails = await this.repository.getUser(link.doctorId, link.organizationID || userOrgId);
        if (docDetails) {
          data.assignedDoctors.push({
            userID: docDetails.userID || link.doctorId,
            fullName: docDetails.fullName ||
              (docDetails.firstName && docDetails.lastName ? `${docDetails.firstName} ${docDetails.lastName}` : docDetails.firstName || ''),
            profilePic: docDetails.profilePic || '',
            specialty: docDetails.specialty || '',
            emailAddress: docDetails.emailAddress || '',
            organizationID: link.organizationID || docDetails.organizationID,
          });
        } else {
          data.assignedDoctors.push({
            userID: link.doctorId,
            fullName: '',
            profilePic: '',
            specialty: '',
            emailAddress: '',
            organizationID: link.organizationID,
          });
        }
      }

      // Fitness apps
      data.fitnessApps = {
        garmin: !!(userBasicDetails as any).garmin,
        fitbit: !!(userBasicDetails as any).fitbit,
      };

      // Task completion status (matches original: checkCompletedTasks)
      data.isTaskCompleted = userBasicDetails.isTaskCompleted !== undefined 
        ? userBasicDetails.isTaskCompleted 
        : await this.repository.checkCompletedTasks(actualUserId);

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

  /**
   * Gets email and phone verification status from Cognito and updates DB if needed
   * Matches original getEmailPhoneVerifiedStatus from helper.js
   */
  private async getEmailPhoneVerifiedStatus(
    userBasicDetails: any,
    userID: string,
    organizationID: string,
  ): Promise<{ emailVerified: boolean; phoneVerified: boolean }> {
    const methodLogger = createChildLogger(baseLogger, { userID, organizationID });
    let emailVerified = userBasicDetails.emailVerified || false;
    let phoneVerified = userBasicDetails.phoneVerified || false;
    let shouldUpdate = false;

    // If not verified in DB, check Cognito
    if ((!emailVerified || !phoneVerified) && userBasicDetails) {
      try {
        const { CognitoIdentityProviderClient, ListUsersCommand } = await import('@aws-sdk/client-cognito-identity-provider');
        const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
        
        // Get user pool ID from secrets manager
        const secretManagerName = process.env.SECRET_MANAGER_NAME;
        let userPoolId: string | undefined;
        
        if (secretManagerName) {
          try {
            const secretClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
            const command = new GetSecretValueCommand({ SecretId: secretManagerName });
            const data = await secretClient.send(command);
            const secretString = 'SecretString' in data 
              ? data.SecretString 
              : (data.SecretBinary ? Buffer.from(data.SecretBinary as any).toString('ascii') : '');
            if (secretString) {
              const secrets = JSON.parse(secretString);
              userPoolId = secrets.USER_POOL_ID;
            }
          } catch (err) {
            methodLogger.warn({ event: 'get_secrets_error', err: serializeError(err) });
          }
        }

        if (userPoolId) {
          const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });
          
          // Check email verification
          if (!emailVerified && userBasicDetails.emailAddress) {
            try {
              const params = {
                UserPoolId: userPoolId,
                Filter: `email = "${userBasicDetails.emailAddress}"`,
              };
              const result = await client.send(new ListUsersCommand(params));
              const cognitoUser = result.Users && result.Users[0];
              if (cognitoUser) {
                const attr = cognitoUser.Attributes?.find((a: any) => a.Name === 'email_verified');
                if (attr && attr.Value === 'true') {
                  emailVerified = true;
                  shouldUpdate = true;
                }
              }
            } catch (err) {
              methodLogger.warn({ event: 'check_email_verification_error', err: serializeError(err) });
            }
          }

          // Check phone verification
          if (!phoneVerified && userBasicDetails.phoneNumber) {
            try {
              const phoneFilter = userBasicDetails.phoneCode 
                ? `phone_number = "${userBasicDetails.phoneCode}${userBasicDetails.phoneNumber}"`
                : `phone_number = "${userBasicDetails.phoneNumber}"`;
              const params = {
                UserPoolId: userPoolId,
                Filter: phoneFilter,
              };
              const result = await client.send(new ListUsersCommand(params));
              const cognitoUser = result.Users && result.Users[0];
              if (cognitoUser) {
                const attr = cognitoUser.Attributes?.find((a: any) => a.Name === 'phone_number_verified');
                if (attr && attr.Value === 'true') {
                  phoneVerified = true;
                  shouldUpdate = true;
                }
              }
            } catch (err) {
              methodLogger.warn({ event: 'check_phone_verification_error', err: serializeError(err) });
            }
          }

          // Update DB if verification status changed
          if (shouldUpdate) {
            try {
              await this.repository.updateUserVerification(userID, organizationID, {
                emailVerified,
                phoneVerified,
              });
            } catch (err) {
              methodLogger.warn({ event: 'update_verification_error', err: serializeError(err) });
            }
          }
        }
      } catch (err) {
        methodLogger.warn({ event: 'getEmailPhoneVerifiedStatus_error', err: serializeError(err) });
      }
    }

    return { emailVerified, phoneVerified };
  }
}

