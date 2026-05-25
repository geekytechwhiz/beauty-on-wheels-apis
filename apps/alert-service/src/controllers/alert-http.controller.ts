/**
  
 *
 * **Flow:** `withApiHandler` builds context + optional schema validation → controller (authz, orchestration) →
 * {@link AlertService} (`@api-hub/alert-core`) → {@link AlertRepository}.
 *
 * **Responses:** shared `withApiHandler` success / {@link handleError} error envelopes (`@api-hub/utils`).
 */
import type { LambdaRequest }  from '@api-hub/utils';
import { BaseError }  from '@api-hub/utils';
import {
  AlertService,
  createAlertPayloadFromHttpBody,
  normalizeAlertServiceError,
  toAlertDetail,
  toPublicAlert,
  type CreateAlertPayload,
  type WorkflowInput,
} from '@api-hub/alert-core';
import {
  parseListAlertsQuery,
  type ValidatedCreateAlert,
  type ValidatedNote,
  type ValidatedAssignment,
  type ValidatedPriority,
  type ValidatedWorkflow,
} from '../validators/request.validators';
import { getActorUserIdForRequest, getOrganizationIdForRequest } from '../utils/helpers';
import alertMetadataWorkaround from '../data/alert-metadata-workaround.json';  
import { publishAlertIntents } from '../handlers/events/publisher/alert-publisher';
import { configureEventRuntime } from '../handlers/events/bootstrap/event-runtime';

configureEventRuntime();

let alertService: AlertService | undefined;
function getAlertService(): AlertService {
  if (!alertService) alertService = new AlertService();
  return alertService;
}

let ctrl: AlertHttpController | undefined;

function unauthorizedOrgError(): BaseError {
  return new BaseError(
    'Organization could not be resolved from the access token',
    401,
    'UNAUTHORIZED',
    [{ message: 'Organization could not be resolved from the access token' }],
    { retryable: false },
  );
}

export class AlertHttpController {
  private readonly svc = getAlertService();

  private ensureEventRuntime(): void {
    configureEventRuntime();
  }

  /**
   * POST /alerts — body validated by {@link validateCreateAlertRequest} in `withApiHandler`; tenant + actor
   * attached there as {@link ValidatedCreateAlert}.
   */
  async handleCreateAlert(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }


    return  {
      "reporterEmail": "doc.paper.d@yopmail.com",
      "isTaskCompleted": false,
      "isLoggedIn": false,
      "tokenUpdatedAt": 1777737405,
      "country": "India",
      "phoneCode": "+91",
      "logoutRequired": false,
      "srcRegisEntity": "email",
      "mrn": "PI-MOOIY7IR307713",
      "devices": [],
      "countryCode": "IND",
      "lastName": "Jasir Hassan",
      "medicalHistory": {
          "allergies": [
              "Food Allergy",
              "Pet Allergy"
          ],
          "symptoms": [],
          "chronicDiseases": [
              "Asthma",
              "Thyroid Disorder",
              "Chronic Kidney Disease"
          ]
      },
      "roleName": "PATIENT",
      "isRegisteredCompletely": false,
      "sk": "USER#01KQMPG288ANNZ9FAMMC1WZEH3",
      "userType": "USER",
      "definedRoleCode": "USER",
      "firstName": "Patient",
      "pk": "ORG#mm3208au877eaa2d",
      "zip": "123456",
      "emailAddress": "pat.jasir.has@yopmail.com",
      "stateCode": "KL",
      "inviteDetails": {},
      "address": "",
      "insuranceDetails": {},
      "isRpmUser": false,
      "emergencyContact": {
          "name": "Father Jasir",
          "phoneCode": "+91",
          "phone": "9809123456",
          "email": "father.jasir.fmq@yopmail.com",
          "relation": "father"
      },
      "reporterProfilePic": "d2zvxvbt9m8l3w.cloudfront.net/profile-picture/USER_34afee49-da99-413e-81d0-d448ee5d6f17/1772085961172",
      "fullName": "Patient Jasir Hassan",
      "modifiedDate": 1777737408080,
      "postalCode": "",
      "city": "Cochin",
      "createdDate": 1777737405365,
      "userRole": [
          "eeea2322-d54f-4d3f-a5f6-9f24d0544e1d"
      ],
      "workSchedule": {},
      "isActive": true,
      "changePassword": true,
      "state": "Kerala",
      "gender": "Male",
      "reporterId": "01KJC8VXGG9VAC4BXXBFD1116S",
      "street": "Kochi",
      "userID": "01KQMPG288ANNZ9FAMMC1WZEH3",
      "dateOfBirth": "12-07-1997",
      "position": "",
      "organizationID": "mm3208au877eaa2d",
      "userCat": [
          "USER"
      ],
      "invitedBy": "01KJC8S5RZDG19EGT3XM5Y7XG3",
      "phoneNumber": "9995123094",
      "userTimeZone": "",
      "namePrefix": "Mr",
      "reporterName": "Dr DOCTOR DERMA",
      "itemType": "USER",
      "accountType": "",
      "patientId": "01KQMPG288ANNZ9FAMMC1WZEH3",
      "profilePic": "",
      "roleType": "",
      "roleID": "",
      "status": true,
      "createdAt": 1777737405365
  } 
  }

  /**
   * POST `/alerts/workflow` — body validated by {@link validateWorkflowRequest}; calls
   * {@link AlertService.applyWorkflow} and returns bulk result.
   */
  async handleUpdateAlertWorkflow(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedWorkflow?: ValidatedWorkflow }).validatedWorkflow;
    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    const performedByUserId = getActorUserIdForRequest(req.event as any, v.authHeader);

    const input: WorkflowInput = {
      alertIds: v.alertIds,
      action: v.action,
      assignToUserId: v.assignToUserId,
      assigneeDisplayName: v.assigneeDisplayName,
      reasonCode: v.reasonCode,
      comment: v.comment,
      closureComment: v.closureComment,
      performedByUserId: performedByUserId ?? undefined,
      performedByDisplayName: v.performedByDisplayName,
    };

    const result = await this.svc.applyWorkflow(v.orgId, input);

    if (result.failed.length > 0 && result.succeeded.length === 0) {
      const f = result.failed[0];
      if (f.code === 'NOT_FOUND') {
        throw Object.assign(new Error(f.message), { statusCode: 404, code: 'NOT_FOUND' });
      }
      if (f.code === 'ILLEGAL_TRANSITION') {
        throw Object.assign(new Error(f.message), { statusCode: 409, code: 'ILLEGAL_TRANSITION' });
      }
      throw Object.assign(new Error(f.message), {
        statusCode: 422,
        code: f.code || 'WORKFLOW_ERROR',
      });
    }

    this.ensureEventRuntime();
    await publishAlertIntents(result.publishIntents, req.context.logger);
    return {
      alertIds: v.alertIds,
      succeeded: result.succeeded,
      failed: result.failed,
    };
  }

  /**
   * POST `/alerts/assignment` — body validated by {@link validateAssignmentRequest}; calls
   * `AlertService.applyAssignment(...)` and returns updated {@link toAlertDetail} when one id was requested.
   * For multi-select, returns `{ alertIds }` on success (all-or-nothing).
   */
  async handleUpdateAlertAssignment(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedAssignment?: ValidatedAssignment }).validatedAssignment;
    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    const performedByUserId = getActorUserIdForRequest(req.event as any, v.authHeader);

    const result = await this.svc.applyAssignment(v.orgId, {
      alertIds: v.alertIds,
      action: v.action,
      ...(v.assignToUserId ? { assignToUserId: v.assignToUserId } : {}),
      performedByUserId: performedByUserId ?? undefined,
      performedByDisplayName: v.performedByDisplayName,
      assigneeDisplayName: v.assigneeDisplayName,
    });

    this.ensureEventRuntime();
    await publishAlertIntents(result.publishIntents, req.context.logger);
    return { alertIds: v.alertIds };
  }

  /**
   * PATCH `/alerts/priority` — body validated by {@link validatePriorityRequest}; calls
   * `AlertService.applyPriority(...)` and returns updated {@link toAlertDetail} when one id was requested.
   * For multi-select, returns `{ alertIds }` on success (all-or-nothing).
   */
  async handleUpdateAlertPriority(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedPriority?: ValidatedPriority }).validatedPriority;
    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    const performedByUserId = getActorUserIdForRequest(req.event as any, v.authHeader);

    const result = await this.svc.applyPriority(v.orgId, {
      alertIds: v.alertIds,
      priority: v.priority,
      performedByUserId: performedByUserId ?? undefined,
      performedByDisplayName: v.performedByDisplayName,
    });

    this.ensureEventRuntime();
    await publishAlertIntents(result.publishIntents, req.context.logger);
    return { alertIds: v.alertIds };
  }

  async handleGetAlert(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) {
      throw new BaseError('alertId required', 400, 'INVALID_REQUEST', [
        { message: 'alertId required' },
      ], { retryable: false });
    }
    return  {
      "reporterEmail": "doc.paper.d@yopmail.com",
      "isTaskCompleted": false,
      "isLoggedIn": false,
      "tokenUpdatedAt": 1777737405,
      "country": "India",
      "phoneCode": "+91",
      "logoutRequired": false,
      "srcRegisEntity": "email",
      "mrn": "PI-MOOIY7IR307713",
      "devices": [],
      "countryCode": "IND",
      "lastName": "Jasir Hassan", 
      
      "roleName": "PATIENT",
      "isRegisteredCompletely": false,
      "sk": "USER#01KQMPG288ANNZ9FAMMC1WZEH3",
      "userType": "USER",
      "definedRoleCode": "USER", 
      "invitedBy": "01KJC8S5RZDG19EGT3XM5Y7XG3",
      "phoneNumber": "9995123094",
      "userTimeZone": "",
      "namePrefix": "Mr",
      "reporterName": "Dr DOCTOR DERMA",
      "itemType": "USER",
      "accountType": "",
      "patientId": "01KQMPG288ANNZ9FAMMC1WZEH3",
      "profilePic": "",
      "roleType": "",
      "roleID": "",
      "status": true,
      "createdAt": 1777737405365
  } 
  }

  async handleGetAlertActivity(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) {
      throw new BaseError('alertId required', 400, 'INVALID_REQUEST', [
        { message: 'alertId required' },
      ], { retryable: false });
    }
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(req.event as any, authHeader);
    if (!orgId) throw unauthorizedOrgError();

    const notesOnly = (req.params as { notesOnly?: string }).notesOnly === 'true';

    const items = await this.svc.listAlertActivity(alertId, orgId, { notesOnly });
    return { items };
  }

  /**
   * GET `/alerts/metadata` — static UI option lists until metadata registry exists (`alert-metadata-workaround.json`).
   */
  async handleGetAlertMetadata(req: LambdaRequest) {
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(req.event as any, authHeader);
    if (!orgId) throw unauthorizedOrgError();
    return alertMetadataWorkaround;
  }

  /**
   * GET /alerts — `queue=TEAM` (default), `MY`, or `PATIENT`. For `PATIENT`, `patientId` is required; for `TEAM`/`MY`,
   * `patientId` must be omitted (use `queue=PATIENT` for patient timeline).
   */
  async handleListAlerts(req: LambdaRequest) {
    const event = req.event;
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(event as any, authHeader);
    if (!orgId) throw unauthorizedOrgError();

    const {
      queue,
      patientId,
      state,
      assignment,
      priority,
      inputType,
      dateFrom,
      dateTo,
      search,
      pageSize,
      nextToken,
    } = parseListAlertsQuery(req.params as Record<string, string | string[] | undefined>);
    const limit = Math.min(100, Math.max(1, pageSize ?? 20));
    const actorUserId = getActorUserIdForRequest(event as any, authHeader);

    const { items, nextToken: nextPageToken } = await this.svc.listAlerts({
      organizationId: orgId,
      actorUserId,
      queue,
      patientId,
      state,
      assignment,
      priority,
      inputType,
      dateFrom,
      dateTo,
      search,
      limit,
      nextToken,
    });

    return {
      items: items.map(toPublicAlert),
      ...(nextPageToken ? { nextToken: nextPageToken } : {}),
    };
  }

  async handleAddAlertNote(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedNote?: ValidatedNote }).validatedNote;
    if (!v) {
      throw new BaseError('Request was not validated before controller', 500, 'INTERNAL_ERROR', [
        { message: 'Request was not validated before controller' },
      ]);
    }

    const performedByUserId = getActorUserIdForRequest(req.event as any, v.authHeader);

    // Call core service to add a note. Expect the core to return the created activity record or similar.
    // Use a best-effort call name `addNote` on the service.
    const { activity, publishIntents } = await this.svc.addNote(
      v.alertId,
      v.orgId,
      v.comment,
      performedByUserId ?? undefined,
      v.performedByDisplayName,
    );

    this.ensureEventRuntime();
    await publishAlertIntents(publishIntents, req.context.logger);
    return activity;
  }
}

export function getAlertHttpController(): AlertHttpController {
  if (!ctrl) ctrl = new AlertHttpController();
  return ctrl;
}
