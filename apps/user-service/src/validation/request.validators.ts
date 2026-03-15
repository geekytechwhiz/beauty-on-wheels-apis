/**
 * Request validators for withLambdaHandler. Each receives the full request and throws
 * an error with statusCode when validation fails.
 */

import {
  assignUserToOrganizationSchema,
  updateUserMetadataSchema,
  validateContactsSchema,
  validateUserExistsSchema,
  activateDeactivateUserSchema,
  assignedPackagesSchema,
  updateRecentInviteSchema,
  createUserSchema,
  assignDoctorSchema,
  listDoctorPatientsQuerySchema,
} from './user.validation';
import {
  createAppointmentSchema,
  getAppointmentSchema,
  listAppointmentsSchema,
} from './appointment.validation';
import { listOrganizationUsersPostSchema } from './listOrganizationUsersPost.validation';
import { fetchFriendFamilySchema, addMemberFriendFamilySchema, updateFriendFamilySchema, deleteFriendFamilySchema, friendFamilySearchSchema } from './friendFamily.validation';
import { v2UserListSchema } from './v2-user-list.validation';

function throwVal(message: string, statusCode = 400, code = 'VALIDATION_ERROR', details?: Array<{ field?: string; message: string }>) {
  const err: any = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (details) err.details = details;
  throw err;
}

/** userId and organizationId required (from params or context.userContext) */
export function validateUserOrganizationRequest(req: any) {
  const userId = req?.params?.userId ?? req?.context?.userContext?.userId;
  const organizationId = req?.params?.organizationId ?? req?.context?.userContext?.organizationId;
  if (!userId || !organizationId) {
    throwVal('userId and organizationId are required', 400, 'BAD_REQUEST');
  }
}

/** userId required in params */
export function validateUserIdParam(req: any) {
  const userId = req?.params?.userId;
  if (!userId || (typeof userId === 'string' && userId.trim() === '')) {
    throwVal('userId is required', 400, 'BAD_REQUEST');
  }
}

export function validateAssignUserToOrganization(req: any) {
  const body = req?.body ?? {};
  const result = assignUserToOrganizationSchema.safeParse(body);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
}

export function validateUpdateUserMetadata(req: any) {
  const userId = req?.params?.userId;
  if (!userId || (typeof userId === 'string' && userId.trim() === '')) {
    throwVal('userId is required', 400, 'BAD_REQUEST');
  }
  const body = req?.body ?? {};
  const result = updateUserMetadataSchema.safeParse({ ...body, userId });
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
  req.validatedUpdateMetadata = result.data;
}

export function validateCreateAppointment(req: any) {
  const body = req?.body ?? {};
  const result = createAppointmentSchema.safeParse(body);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
  req.validatedCreateAppointment = result.data;
}

export function validateGetAppointment(req: any) {
  const payload = {
    patientUserId: req?.pathParameters?.patientUserId ?? req?.params?.patientUserId,
    appointmentId: req?.pathParameters?.appointmentId ?? req?.params?.appointmentId,
  };
  const result = getAppointmentSchema.safeParse(payload);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
  req.validatedGetAppointment = result.data;
}

export function validateListAppointments(req: any) {
  const payload = {
    patientUserId: req?.pathParameters?.patientUserId ?? req?.params?.patientUserId,
  };
  const result = listAppointmentsSchema.safeParse(payload);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
  req.validatedListAppointments = result.data;
}

export function validateContacts(req: any) {
  const body = req?.body ?? {};
  const result = validateContactsSchema.safeParse(body);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      400,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
}

export function validateValidateUsers(req: any) {
  const body = req?.body ?? {};
  const result = validateUserExistsSchema.safeParse(body);
  if (!result.success) {
    throwVal(result.error.issues[0]?.message ?? 'Validation failed', 400, 'VALIDATION_ERROR');
  }
}

export function validateGetOrganizationUserCount(req: any) {
  const organizationId = req?.params?.organizationId ?? req?.context?.userContext?.organizationId;
  if (!organizationId?.trim()) {
    const err: any = new Error('Organization ID not found in token');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
}

export function validateActivateDeactivateUser(req: any) {
  const body = req?.body ?? {};
  const organizationID = req?.context?.userContext?.organizationId ?? body.organizationID;
  const patientUserId = body.patientUserId ?? req?.context?.user?.userId;
  const payload = { ...body, organizationID, patientUserId };
  const result = activateDeactivateUserSchema.safeParse(payload);
  if (!result.success) {
    throwVal(result.error.issues[0]?.message ?? 'Validation failed', 400, 'VALIDATION_ERROR');
  }
  const data = result.data;
  if (!data?.organizationID?.trim() || !data?.patientUserId?.trim()) {
    throwVal('organizationId and target userId are required', 400, 'BAD_REQUEST');
  }
  req.validatedActivateDeactivate = data;
}

export function validateAssignedPackages(req: any) {
  const body = req?.body ?? {};
  const result = assignedPackagesSchema.safeParse(body);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
  req.validatedAssignedPackages = result.data;
}

export function validateFetchFriendFamily(req: any) {
  const body = req?.body ?? {};
  const userId = body?.userId ?? body?.userID ?? req?.context?.user?.userId ?? req?.params?.userId;
  const result = fetchFriendFamilySchema.safeParse({ userId: userId ?? '' });
  if (!result.success || !userId) {
    throwVal('userId is required', 400, 'BAD_REQUEST');
  }
}

export function validateAddMemberFriendFamily(req: any) {
  const body = req?.body ?? {};
  const organizationID =
    body.organizationID ??
    req?.context?.userContext?.organizationId ??
    req?.context?.user?.organizationId;
  const userId =
    body.userId ??
    body.userID ??
    req?.context?.userContext?.userId ??
    req?.context?.user?.userId;
  const payload = { ...body, organizationID, userId };
  const result = addMemberFriendFamilySchema.safeParse(payload);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
  if (!organizationID?.trim() || !userId?.trim()) {
    const err: any = new Error('Unauthorized');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
}

export function validateUpdateFriendFamily(req: any) {
  const body = req?.body ?? {};
  const organizationID =
    body.organizationID ??
    req?.context?.userContext?.organizationId ??
    req?.context?.user?.organizationId;
  const userId =
    body.userId ??
    body.userID ??
    req?.context?.userContext?.userId ??
    req?.context?.user?.userId;
  const payload = { ...body, organizationID };
  const result = updateFriendFamilySchema.safeParse(payload);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
  const data = result.data;
  if (!userId?.trim() || !data?.organizationID?.trim()) {
    const err: any = new Error('Unauthorized');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
}

export function validateDeleteFriendFamily(req: any) {
  const body = req?.body ?? {};
  const result = deleteFriendFamilySchema.safeParse(body);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      400,
      'BAD_REQUEST',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
}

export function validateFriendFamilySearch(req: any) {
  if (!req?.context?.authHeader?.trim()) {
    const err: any = new Error('Unauthorized');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  const body = req?.body ?? {};
  const organizationID =
    body.organizationID ??
    req?.context?.userContext?.organizationId ??
    req?.context?.user?.organizationId;
  const result = friendFamilySearchSchema.safeParse({ ...body, organizationID });
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
}

/** Query params: inviterId, inviteeId */
export function validateFriendFamilyCheck(req: any) {
  const inviterId = (req?.params?.inviterId ?? '').toString().trim();
  const inviteeId = (req?.params?.inviteeId ?? '').toString().trim();
  if (!inviterId || !inviteeId) {
    throwVal('inviterId and inviteeId query parameters are required', 400, 'BAD_REQUEST');
  }
}

export function validateUpdateRecentInvite(req: any) {
  const body = req?.body ?? {};
  const payload = {
    ...body,
    patientId: body.patientId ?? req?.context?.user?.userId,
  };
  const result = updateRecentInviteSchema.safeParse(payload);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      400,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
  const data = result.data;
  if (!data?.patientId?.trim()) {
    throwVal('patientId is required', 400, 'MISSING_REQUIRED_FIELDS');
  }
  if (data?.email === undefined && data?.sms === undefined) {
    throwVal('At least one of email or sms must be provided', 400, 'VALIDATION_ERROR');
  }
  req.validatedUpdateRecentInvite = data;
}

/** organizationId required in params or userContext */
export function validateOrganizationIdParam(req: any) {
  const organizationId = req?.params?.organizationId ?? req?.context?.userContext?.organizationId;
  if (!organizationId || (typeof organizationId === 'string' && organizationId.trim() === '')) {
    throwVal('organizationId is required', 400, 'BAD_REQUEST');
  }
}

export function validateListOrganizationUsersPost(req: any) {
  const body = req?.body ?? {};
  const result = listOrganizationUsersPostSchema.safeParse(body);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      400,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
  req.validatedListOrganizationUsersPost = result.data;
}

/** V2 user list body validation */
export function validateV2UserList(req: any) {
  const body = req?.body ?? {};
  const result = v2UserListSchema.safeParse(body);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      400,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
  req.validatedV2UserList = result.data;
}

/** userId and organizationId required (from params, body, or context.userContext) for updateUser */
export function validateUpdateUser(req: any) {
  const userId = req?.params?.userId ?? req?.body?.userId ?? req?.body?.userID ?? req?.context?.userContext?.userId;
  const organizationId = req?.params?.organizationId ?? req?.body?.organizationId ?? req?.body?.organizationID ?? req?.context?.userContext?.organizationId;
  if (!userId || !organizationId) {
    const err: any = new Error('Missing user context in access token');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
}

export function validateAssignDoctor(req: any) {
  const body = req?.body ?? {};
  const result = assignDoctorSchema.safeParse(body);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
}

export function validateCreateUser(req: any) {
  const body = req?.body ?? {};
  const organizationID = body.organizationID ?? req?.context?.userContext?.organizationId;
  const userID = body.userID ?? req?.context?.userContext?.userId;
  const payload = { ...body, organizationID, userID };
  const result = createUserSchema.safeParse(payload);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
    );
  }
  req.validatedCreateUser = { ...result.data, organizationID, userID };
}

export function validateListDoctorPatients(req: any) {
  const body = req?.body ?? {};
  const params = req?.params ?? {};
  const organizationID = body.organizationID ?? params.organizationID ?? req?.context?.userContext?.organizationId;
  const userID = body.userID ?? params.userID ?? req?.context?.userContext?.userId;
  const payload = {
    filter: body.filter ?? params.filter ?? 'staff',
    organizationID,
    userID,
    showConsultations: body.showConsultations ?? params.showConsultations,
    showActiveAppointment: body.showActiveAppointment ?? params.showActiveAppointment,
  };
  const result = listDoctorPatientsQuerySchema.safeParse(payload);
  if (!result.success) {
    throwVal(result.error.issues[0]?.message ?? 'Validation failed', 400, 'LIST_DOCTOR_PATIENTS_FAILED');
  }
  if (payload.filter === 'assigned-patient' && !userID) {
    throwVal('User ID is required for assigned-patient filter', 400, 'LIST_DOCTOR_PATIENTS_FAILED');
  }
  req.validatedListDoctorPatients = result.data;
}
