import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import {
  createLogger,
  createChildLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
} from '@api-hub/logger';
import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { ApiResponse } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { UserNotFoundError } from '../utils/errors';
import { getAuthorizerUserId, getAuthorizerOrganizationId } from '../utils/helpers';
import { SchedulePreferences } from '../models/Schedule';
import { scheduleServiceClient } from '../clients/scheduleService.client';
import { updateUserSchema } from '../validation/user.validation';
import { validateUpdateUser } from '../validation/request.validators';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

async function updateUser(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const baseLogContext = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });

  const requestUserId = getAuthorizerUserId(event);
  const requestOrgId = getAuthorizerOrganizationId(event);

  let body: any;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    baseLogContext.error({
      event: 'updateUser_parse_error',
      err: serializeError(err as Error),
    });
    const duration = Date.now() - startTime;
    logHttpRequest(
      baseLogContext,
      event.httpMethod || 'PUT',
      event.path || `/users/unknown`,
      400,
      duration,
      correlationId,
    );
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'Invalid JSON body' }],
      },
    );
  }

  let userId = body?.userId || body?.userID || requestUserId;
  let organizationId =
    body?.organizationId || body?.organizationID || requestOrgId;

  if (
    (!userId || !organizationId) &&
    (event.headers?.Authorization || event.headers?.authorization)
  ) {
    try {
      const authHeader =
        event.headers?.Authorization || event.headers?.authorization || '';
      const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
      const base64Url = token.split('.')[1];
      if (base64Url) {
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          Buffer.from(base64, 'base64')
            .toString()
            .split('')
            .map(
              (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2),
            )
            .join(''),
        );
        const decoded = JSON.parse(jsonPayload);
        if (!userId) {
          userId =
            decoded['custom:userID'] ||
            decoded['custom:userId'] ||
            decoded.userID ||
            decoded.userId ||
            decoded.sub;
        }
        if (!organizationId) {
          organizationId =
            decoded['custom:organizationID'] ||
            decoded['custom:organizationId'] ||
            decoded.organizationID ||
            decoded.organizationId;
        }
      }
    } catch {
    }
  }

  if (!userId || !organizationId) {
    const duration = Date.now() - startTime;
    logHttpRequest(
      baseLogContext,
      event.httpMethod || 'PUT',
      event.path || '/user',
      401,
      duration,
      correlationId,
    );
    return ApiResponse.unauthorized(
      'COMMON.UNAUTHORIZED',
      { requestId: correlationId, event },
      {
        code: 'UNAUTHORIZED',
        details: [{ message: 'Missing user context in access token' }],
      },
    );
  }

  const resolvedUserId = userId;
  const resolvedOrganizationId = organizationId;
  const logger = createChildLogger(baseLogger, {
    correlationId,
    userId: resolvedUserId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'updateUser_received', eventData: event });

  let action = body?.action ? String(body.action).toUpperCase() : undefined;
  if (action) {
    const actionAliases: Record<string, string> = {
      GEN: 'GENERAL_SETTINGS',
      UNITS: 'UNITS_SETTINGS',
      COMM: 'COMMUNICATION_SETTINGS',
      UPLOAD_IMAGE: 'UPLOAD',
      DELETE_IMAGE: 'DELETE',
    };
    action = actionAliases[action] ?? action;
    const duration = Date.now() - startTime;
    const hasOwn = (obj: Record<string, unknown>, key: string) =>
      Object.prototype.hasOwnProperty.call(obj, key);
    const setIfPresent = (
      target: Record<string, unknown>,
      key: string,
      value: unknown,
    ) => {
      if (hasOwn(body, key)) {
        target[key] = value;
      }
    };
    const validateWorkingHours = (workingHours: unknown) => {
      const days = [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ];
      if (!workingHours || typeof workingHours !== 'object') {
        return 'workingHours must be an object';
      }
      const hours = workingHours as Record<string, any>;
      for (const day of days) {
        const dayConfig = hours[day];
        if (!dayConfig || typeof dayConfig !== 'object') {
          return `${day} must be an object`;
        }
        if (typeof dayConfig.available !== 'boolean') {
          return `${day}.available must be a boolean`;
        }
        if (dayConfig.available === true) {
          if (
            !Array.isArray(dayConfig.availableHours) ||
            dayConfig.availableHours.length === 0
          ) {
            return `${day}.availableHours is required when available is true`;
          }
          for (const entry of dayConfig.availableHours) {
            const from = entry?.from;
            const to = entry?.to;
            const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
            if (
              !timeRegex.test(String(from || '')) ||
              !timeRegex.test(String(to || ''))
            ) {
              return `${day}.availableHours must include valid from/to in HH:mm format`;
            }
          }
        }
      }
      return undefined;
    };

    try {
      const existing = await userService.getUser(userId, organizationId);
      const userData: Record<string, unknown> = {};
      let isWorkingHoursUpdate = false;

      switch (action) {
        case 'LANGUAGE': {
          if (!body?.language) {
            return ApiResponse.badRequest(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              {
                code: 'VALIDATION_ERROR',
                details: [
                  {
                    field: 'language',
                    message: 'language is required',
                  },
                ],
              },
            );
          }
          userData.language = body.language;
          break;
        }
        case 'DATE_FORMAT': {
          if (!body?.dateFormat) {
            return ApiResponse.badRequest(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              {
                code: 'VALIDATION_ERROR',
                details: [
                  {
                    field: 'dateFormat',
                    message: 'dateFormat is required',
                  },
                ],
              },
            );
          }
          userData.dateFormat = body.dateFormat;
          break;
        }
        case 'UNITS_SETTINGS': {
          // Support both wrapped format and flat format
          let unitsSettings =
            body?.unitsSettings ?? body?.unitSettings ?? body?.units;
          
          // If no wrapper provided, build from flat fields
          if (!unitsSettings) {
            const unitKeys = [
              'glucometerUnit',
              'weightUnit',
              'heightUnit',
              'temperatureUnit',
              'distanceUnit',
              'bloodPressureUnit',
              'cholesterolUnit',
              'bloodGlucoseUnit',
              'oximeterUnit',
              'heartBeatUnit',
              'waterUnit',
              'oxygenUnit',
              'caloriesUnit',
              'speedUnit',
              'powerUnit',
              'physicalEffortUnit',
            ];
            const builtSettings: Record<string, unknown> = {};
            for (const key of unitKeys) {
              if (hasOwn(body, key)) {
                builtSettings[key] = body[key];
              }
            }
            // Backwards-compatible aliases that clients sometimes send
            if (hasOwn(body, 'distance') && !hasOwn(builtSettings, 'distanceUnit')) {
              builtSettings.distanceUnit = body.distance;
            }
            if (hasOwn(body, 'water') && !hasOwn(builtSettings, 'waterUnit')) {
              builtSettings.waterUnit = body.water;
            }
            if (Object.keys(builtSettings).length > 0) {
              unitsSettings = builtSettings;
            }
          }

          // Normalize common aliases inside the wrapped object too
          if (unitsSettings && typeof unitsSettings === 'object') {
            const us = unitsSettings as Record<string, unknown>;
            if (us.distance !== undefined && us.distanceUnit === undefined) {
              us.distanceUnit = us.distance;
              delete us.distance;
            }
            if (us.water !== undefined && us.waterUnit === undefined) {
              us.waterUnit = us.water;
              delete us.water;
            }
          }
          
          if (!unitsSettings || Object.keys(unitsSettings).length === 0) {
            return ApiResponse.badRequest(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              {
                code: 'VALIDATION_ERROR',
                details: [
                  {
                    field: 'unitsSettings',
                    message: 'At least one unit setting is required (e.g., glucometerUnit, weightUnit)',
                  },
                ],
              },
            );
          }

          // Merge with existing unitsSettings so partial updates don't reset other keys
          const existingUnitsSettings =
            (existing as any)?.unitsSettings &&
            typeof (existing as any).unitsSettings === 'object'
              ? (existing as any).unitsSettings
              : {};
          userData.unitsSettings = {
            ...existingUnitsSettings,
            ...(unitsSettings as Record<string, unknown>),
          };
          break;
        }
        case 'COMMUNICATION_SETTINGS': {
          // Support both wrapped format and flat format
          let communicationSettings =
            body?.communicationSettings ?? body?.notifications;
          
          // If no wrapper provided, build from flat fields
          if (!communicationSettings) {
            const commKeys = ['email', 'sms', 'push', 'inApp', 'whatsapp'];
            const builtSettings: Record<string, unknown> = {};
            for (const key of commKeys) {
              if (hasOwn(body, key)) {
                builtSettings[key] = body[key];
              }
            }
            if (Object.keys(builtSettings).length > 0) {
              communicationSettings = builtSettings;
            }
          }
          
          if (!communicationSettings || Object.keys(communicationSettings).length === 0) {
            return ApiResponse.badRequest(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              {
                code: 'VALIDATION_ERROR',
                details: [
                  {
                    field: 'communicationSettings',
                    message: 'At least one communication setting is required (e.g., email, sms, push)',
                  },
                ],
              },
            );
          }
          userData.communicationSettings = communicationSettings;
          break;
        }
        case 'GENERAL_SETTINGS': {
          const keys = [
            'promotions',
            'medication',
            'appointment',
            'newsAndArticles',
            'emergencyVital',
            'medicationReminders',
            'appointmentReminders',
            'activityGoals',
            'healthCheckIn',
            'debugMode',
          ];
          const generalSetting: Record<string, unknown> = {};
          for (const key of keys) {
            if (hasOwn(body, key)) {
              const raw = body[key];
              // Normalize to boolean so we don't persist 0/1 integers
              const value =
                typeof raw === 'boolean'
                  ? raw
                  : raw === 1 ||
                    raw === '1' ||
                    raw === 'true' ||
                    raw === 'TRUE';
              generalSetting[key] = value;
            }
          }
          if (Object.keys(generalSetting).length === 0) {
            return ApiResponse.badRequest(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              {
                code: 'VALIDATION_ERROR',
                details: [
                  {
                    field: 'generalSetting',
                    message: 'general settings are required',
                  },
                ],
              },
            );
          }
          // Also store the consolidated object for backwards compatibility
          userData.generalSetting = generalSetting;
          break;
        }
        case 'UPLOAD': {
          const emailInput = hasOwn(body, 'emailAddress')
            ? body.emailAddress
            : hasOwn(body, 'email')
            ? body.email
            : undefined;
          const phoneInput = hasOwn(body, 'phoneNumber')
            ? body.phoneNumber
            : hasOwn(body, 'phone')
            ? body.phone
            : undefined;

          setIfPresent(userData, 'profilePic', body.profilePic);
          setIfPresent(userData, 'firstName', body.firstName);
          setIfPresent(userData, 'middleName', body.middleName);
          setIfPresent(userData, 'lastName', body.lastName);
          setIfPresent(userData, 'fullName', body.fullName);
          setIfPresent(userData, 'gender', body.gender);
          setIfPresent(userData, 'weightInLbs', body.weightInLbs);
          setIfPresent(userData, 'weightInKG', body.weightInKG);
          setIfPresent(userData, 'heightInCm', body.heightInCm);
          setIfPresent(userData, 'heightInFeet', body.heightInFeet);
          setIfPresent(userData, 'country', body.country);
          setIfPresent(userData, 'dateOfBirth', body.dateOfBirth);
          setIfPresent(userData, 'address', body.address);
          setIfPresent(userData, 'postalCode', body.postalCode);
          setIfPresent(userData, 'zip', body.zip);
          setIfPresent(userData, 'cloudOpt', body.cloudOpt);
          setIfPresent(
            userData,
            'additionalPhoneNumbers',
            body.additionalPhoneNumbers,
          );
          setIfPresent(
            userData,
            'additionalEmailIDs',
            body.additionalEmailIDs,
          );
          setIfPresent(
            userData,
            'isRegisteredCompletely',
            body.isRegisteredCompletely,
          );
          setIfPresent(userData, 'appName', body.appName);
          setIfPresent(userData, 'accountStatus', body.accountStatus);
          setIfPresent(userData, 'phoneLocale', body.phoneLocale);
          setIfPresent(userData, 'locale', body.locale);
          setIfPresent(userData, 'userTimeZone', body.userTimeZone);
          setIfPresent(userData, 'stateCode', body.stateCode);
          setIfPresent(userData, 'countryCode', body.countryCode);
          setIfPresent(userData, 'region', body.region);
          setIfPresent(userData, 'assignRoomNo', body.assignRoomNo);
          setIfPresent(userData, 'lastAppointment', body.lastAppointment);
          setIfPresent(userData, 'state', body.state);
          setIfPresent(userData, 'street', body.street);
          setIfPresent(userData, 'city', body.city);
          setIfPresent(userData, 'position', body.position);
          setIfPresent(userData, 'department', body.department);
          setIfPresent(userData, 'licenseNumber', body.licenseNumber);
          setIfPresent(userData, 'specialty', body.specialty);
          setIfPresent(
            userData,
            'experienceInYears',
            body.experienceInYears,
          );
          setIfPresent(userData, 'bio', body.bio);
          setIfPresent(userData, 'ethnicity', body.ethnicity);
          setIfPresent(userData, 'maritalStatus', body.maritalStatus);
          setIfPresent(userData, 'bloodGroup', body.bloodGroup);
          setIfPresent(userData, 'namePrefix', body.namePrefix);
          setIfPresent(
            userData,
            'appleHealthLastSync',
            body.appleHealthLastSync,
          );
          setIfPresent(
            userData,
            'googleFitLastSync',
            body.googleFitLastSync,
          );
          if (emailInput !== undefined) {
            userData.emailAddress = emailInput;
          }
          if (phoneInput !== undefined) {
            userData.phoneNumber = phoneInput;
          }
          if (hasOwn(body, 'phoneCode')) {
            userData.phoneCode = body.phoneCode;
          }
          if (Array.isArray(body.acceptedAppForms)) {
            const existingForms = Array.isArray(
              (existing as any).acceptedAppForms,
            )
              ? (existing as any).acceptedAppForms
              : [];
            const merged = [...existingForms];
            for (const form of body.acceptedAppForms) {
              const versionId = (form as any)?.versionId;
              if (
                !versionId ||
                merged.some(
                  (existingForm) => existingForm.versionId === versionId,
                )
              ) {
                continue;
              }
              merged.push({ ...form, acceptedDate: Date.now() });
            }
            userData.acceptedAppForms = merged;
          }
          break;
        }
        case 'DELETE': {
          userData.profilePic = '';
          break;
        }
        case 'ALLERGIES': {
          userData.medicalHistory = {
            ...(existing as any).medicalHistory || {},
            allergies: Array.isArray(body?.allergies) ? body.allergies : [],
          };
          break;
        }
        case 'CHIEF_MEDICAL_ISSUE': {
          if (!body?.chiefMedicalIssue) {
            return ApiResponse.badRequest(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              {
                code: 'VALIDATION_ERROR',
                details: [
                  {
                    field: 'chiefMedicalIssue',
                    message: 'chiefMedicalIssue is required',
                  },
                ],
              },
            );
          }
          userData.chiefMedicalIssue = body.chiefMedicalIssue;
          break;
        }
        case 'SUBSTANCE_MISUSE': {
          setIfPresent(userData, 'smoking', body.smoking ?? '');
          setIfPresent(
            userData,
            'alcoholConsumption',
            body.alcoholConsumption ?? '',
          );
          break;
        }
        case 'EMERGENCY_CONTACT': {
          if (!body?.emergencyContact || Object.keys(body.emergencyContact).length === 0) {
            return ApiResponse.badRequest(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              {
                code: 'VALIDATION_ERROR',
                details: [
                  {
                    field: 'emergencyContact',
                    message: 'emergencyContact is required',
                  },
                ],
              },
            );
          }
          userData.emergencyContact = body.emergencyContact;
          break;
        }
        case 'WORKING_HOURS': {
          const validationMessage = validateWorkingHours(body?.workingHours);
          if (validationMessage) {
            return ApiResponse.badRequest(
              'COMMON.VALIDATION_ERROR',
              { requestId: correlationId, event },
              {
                code: 'VALIDATION_ERROR',
                details: [
                  {
                    field: 'workingHours',
                    message: validationMessage,
                  },
                ],
              },
            );
          }
          const hours = body.workingHours as Record<
            string,
            { available: boolean; availableHours?: Array<{ from: string; to: string }> }
          >;
          const normalized: Record<
            string,
            { available: boolean; availableHours: Array<{ from: string; to: string }> }
          > = {};
          const days = [
            'monday',
            'tuesday',
            'wednesday',
            'thursday',
            'friday',
            'saturday',
            'sunday',
          ];
          for (const day of days) {
            const d = hours[day];
            normalized[day] = {
              available: !!d?.available,
              availableHours: d?.available
                ? Array.isArray(d.availableHours)
                  ? d.availableHours
                  : []
                : [],
            };
          }
          userData.workingHours = normalized;
          if (body?.slotDurationInMinutes !== undefined) {
            userData.slotDurationInMinutes = body.slotDurationInMinutes;
          } else {
            userData.slotDurationInMinutes = 30;
          }
          isWorkingHoursUpdate = true;
          break;
        }
        default: {
          return ApiResponse.badRequest(
            'COMMON.BAD_REQUEST',
            { requestId: correlationId, event },
            { code: 'ACTION_SHOULD_BE_DELETE_AND_UPLOAD' },
          );
        }
      }

      await userService.updateUser(
        resolvedUserId,
        resolvedOrganizationId,
        userData,
        correlationId,
      );

      if (isWorkingHoursUpdate && userData.workingHours) {
        if (!scheduleServiceClient) {
          logger.warn({
            event: 'updateUser_schedule_prefs_skipped',
            reason: 'SCHEDULE_SERVICE_API_URL not set',
          });
        } else {
          try {
            const authHeader =
              event.headers?.Authorization ?? event.headers?.authorization;
            const existingPrefs =
              await scheduleServiceClient.getSchedulePreferences(
                resolvedUserId,
                resolvedOrganizationId,
                authHeader,
              );
            const prefs: SchedulePreferences = {
              ...(existingPrefs || {}),
              workingHours:
                userData.workingHours as SchedulePreferences['workingHours'],
              slotDurationInMinutes:
                (userData.slotDurationInMinutes as number) ??
                existingPrefs?.slotDurationInMinutes ??
                30,
            };
            await scheduleServiceClient.putSchedulePreferences(
              resolvedUserId,
              resolvedOrganizationId,
              prefs,
              authHeader,
            );
          } catch (syncErr) {
            logger.warn({
              event: 'updateUser_schedule_prefs_sync_failed',
              err: serializeError(syncErr as Error),
            });
          }
        }
      }

      logHttpRequest(
        logger,
        event.httpMethod || 'PUT',
        event.path || '/user',
        200,
        duration,
        correlationId,
      );
      return ApiResponse.ok(
        {},
        {
          title: 'Success',
          description: 'The operation completed successfully.',
          severity: 'SUCCESS',
        },
        { requestId: correlationId, event },
      );
    } catch (err) {
      logger.error({
        event: 'updateUser_action_error',
        err: serializeError(err as Error),
      });
      logHttpRequest(
        logger,
        event.httpMethod || 'PUT',
        event.path || '/user',
        500,
        duration,
        correlationId,
      );
      return ApiResponse.internalServerError(
        'USER.UPDATE_USER_FAILED',
        { requestId: correlationId, event },
        {
          code: 'UPDATE_USER_FAILED',
          details: [
            { message: (err as Error)?.message || 'Unknown error' },
          ],
        },
      );
    }
  }

  const validation = updateUserSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({
      event: 'updateUser_validation_error',
      errors: validation.error.issues,
    });
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || '/user',
      400,
      duration,
      correlationId,
    );
    return ApiResponse.badRequest(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    const data = validation.data;
    const userData: any = {};

    if (data.profilePic !== undefined) userData.profilePic = data.profilePic;
    if (data.namePrefix !== undefined) userData.namePrefix = data.namePrefix;
    if (data.bio !== undefined) userData.bio = data.bio;
    if (data.gender !== undefined) userData.gender = data.gender;
    if (data.dateOfBirth !== undefined) userData.dateOfBirth = data.dateOfBirth;
    if (data.specialty !== undefined) userData.specialty = data.specialty;
    if (data.department !== undefined) userData.department = data.department;
    if (data.licenseNumber !== undefined)
      userData.licenseNumber = data.licenseNumber;

    if (data.email !== undefined) userData.emailAddress = data.email;
    if (data.phone !== undefined) userData.phoneNumber = data.phone;
    if (data.phoneCode !== undefined) userData.phoneCode = data.phoneCode;

    if (data.firstName !== undefined) userData.firstName = data.firstName;
    if (data.lastName !== undefined) userData.lastName = data.lastName;
    if (data.fullName !== undefined) userData.fullName = data.fullName;
    if (data.name !== undefined) userData.fullName = data.name;

    if (data.address !== undefined) userData.address = data.address;
    if (data.city !== undefined) userData.city = data.city;
    if (data.state !== undefined) userData.state = data.state;
    if (data.country !== undefined) userData.country = data.country;
    if (data.postalCode !== undefined) userData.postalCode = data.postalCode;
    if (data.countryCode !== undefined)
      userData.countryCode = data.countryCode;

    if (data.email !== undefined || data.phone !== undefined) {
      const isEmail = data.email && data.email.includes('@');
      userData.srcRegisEntity = isEmail ? 'email' : 'phone_number';
    }

    await userService.updateUser(
      userId,
      organizationId,
      userData,
      correlationId,
    );
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || '/user',
      200,
      duration,
      correlationId,
    );
    return ApiResponse.ok(
      {},
      {
        title: 'Success',
        description: 'The operation completed successfully.',
        severity: 'SUCCESS',
      },
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'PUT',
        event.path || '/user',
        404,
        duration,
        correlationId,
      );
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        {
          code: 'USER_NOT_FOUND',
          details: [{ message: err.message }],
        },
      );
    }
    logger.error({
      event: 'updateUser_error',
      err: serializeError(err as Error),
    });
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      event.path || '/user',
      500,
      duration,
      correlationId,
    );
    return ApiResponse.internalServerError(
      'USER.UPDATE_USER_FAILED',
      { requestId: correlationId, event },
      {
        code: 'UPDATE_USER_FAILED',
        details: [
          { message: (err as Error)?.message || 'Unknown error' },
        ],
      },
    );
  }
}

const handler = async (req: LambdaRequest<any>) => {
  const event: APIGatewayProxyEvent = {
    ...req.event,
    pathParameters: {
      ...req.event.pathParameters,
      userId: req.params?.userId ?? req.body?.userId ?? req.body?.userID ?? req.context?.userContext?.userId,
      organizationId: req.params?.organizationId ?? req.body?.organizationId ?? req.body?.organizationID ?? req.context?.userContext?.organizationId,
    },
    body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}),
  };
  const context = { awsRequestId: req.context?.awsRequestId } as Context;
  const res = await updateUser(event, context);
  const parsed = (() => {
    try {
      return JSON.parse(res.body || '{}');
    } catch {
      return {};
    }
  })();
  if (res.statusCode >= 400) {
    const err: any = new Error(parsed?.details?.[0]?.message || parsed?.message || 'Request failed');
    err.statusCode = res.statusCode;
    err.code = parsed?.code || 'UPDATE_USER_FAILED';
    err.details = parsed?.details;
    throw err;
  }
  return parsed;
};

export const main = withLambdaHandler(handler, {
  validator: validateUpdateUser,
});

