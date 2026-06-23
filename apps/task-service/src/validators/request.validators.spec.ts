import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { LambdaRequest } from '@api-hub/utils';

import { bearerToken } from '../__tests__/handler-test-utils';
import {
  validateCreateMonitoringActionRequest,
  validateCreateRuntimeTaskRequest,
  validateGenerateCarePlanTasksRequest,
  validateGetActionCenterItemsRequest,
  validateGetRuntimeTaskHistoryRequest,
  validateGetRuntimeTaskRequest,
  validateGetStaffTasksRequest,
  validateGetTaskStatusSummaryRequest,
  validateGetTasksRequest,
  validateUpdateAssignedStaffRequest,
  validateUpdateReminderSettingsRequest,
  validateUpdateRuntimeTaskRequest,
  validateUpdateTaskStateRequest,
} from './request.validators';

function baseEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/dev/tasks',
    pathParameters: null,
    queryStringParameters: null,
    headers: {
      Authorization: bearerToken({
        'custom:organizationID': 'org-1',
        'custom:userID': 'user-1',
      }),
    },
    body: null,
    requestContext: {},
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

function baseReq(overrides: Partial<LambdaRequest> = {}): LambdaRequest {
  const event = (overrides.event as APIGatewayProxyEvent | undefined) ?? baseEvent();
  return {
    event,
    params: {},
    body: {},
    query: {},
    pathParameters: event.pathParameters ?? undefined,
    context: {
      correlationId: 'corr-1',
      awsRequestId: 'aws-1',
      authHeader: event.headers?.Authorization,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    },
    ...overrides,
  } as unknown as LambdaRequest;
}

function reqWithAuthorizer(authorizer: Record<string, string>, overrides: Partial<LambdaRequest> = {}): LambdaRequest {
  return baseReq({
    event: baseEvent({
      requestContext: { authorizer },
      headers: {},
    }),
    context: {
      correlationId: 'corr-1',
      awsRequestId: 'aws-1',
      authHeader: undefined,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    },
    ...overrides,
  });
}

function expectValidationError(fn: () => void, statusCode: number, code?: string): void {
  try {
    fn();
    fail('expected validation error');
  } catch (e: unknown) {
    const err = e as { statusCode?: number; code?: string };
    expect(err.statusCode).toBe(statusCode);
    if (code) expect(err.code).toBe(code);
  }
}

describe('request.validators', () => {
  describe('validateCreateMonitoringActionRequest', () => {
    it('attaches validated payload when org resolves', () => {
      const req = baseReq({
        body: { patientId: 'pat-1' },
      });
      validateCreateMonitoringActionRequest(req);
      expect((req as { validatedCreateMonitoringAction?: { orgId: string } }).validatedCreateMonitoringAction?.orgId).toBe(
        'org-1',
      );
    });

    it('resolves org from API Gateway authorizer', () => {
      const req = reqWithAuthorizer({ organizationID: 'org-authorizer' }, { body: { patientId: 'pat-1' } });
      validateCreateMonitoringActionRequest(req);
      expect((req as { validatedCreateMonitoringAction?: { orgId: string } }).validatedCreateMonitoringAction?.orgId).toBe(
        'org-authorizer',
      );
    });

    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({ headers: { Authorization: bearerToken({ 'custom:userID': 'u1' }) } }),
      });
      expectValidationError(() => validateCreateMonitoringActionRequest(req), 401, 'UNAUTHORIZED');
    });
  });

  describe('validateCreateRuntimeTaskRequest', () => {
    it('uses manualSystem actor from token', () => {
      const req = baseReq({
        body: { runtimeTaskSource: 'manualSystem', patientId: 'pat-1' },
      });
      validateCreateRuntimeTaskRequest(req);
      const validated = (req as { validatedCreateRuntimeTask?: { createdBy: string } }).validatedCreateRuntimeTask;
      expect(validated?.createdBy).toBe('user:user-1');
    });

    it('uses service flow actor for non-manual sources', () => {
      const req = baseReq({
        body: { runtimeTaskSource: 'serviceFlowRuntime', patientId: 'pat-1' },
      });
      validateCreateRuntimeTaskRequest(req);
      const validated = (req as { validatedCreateRuntimeTask?: { createdBy: string } }).validatedCreateRuntimeTask;
      expect(validated?.createdBy).toBe('system:service-flow-runtime');
    });

    it('uses manualSystem actor from authorizer userID', () => {
      const req = reqWithAuthorizer(
        { organizationID: 'org-1', userID: 'staff-42' },
        { body: { runtimeTaskSource: 'manualSystem', patientId: 'pat-1' } },
      );
      validateCreateRuntimeTaskRequest(req);
      expect((req as { validatedCreateRuntimeTask?: { createdBy: string } }).validatedCreateRuntimeTask?.createdBy).toBe(
        'user:staff-42',
      );
    });

    it('throws 422 when manualSystem and user id missing', () => {
      const req = baseReq({
        event: baseEvent({ headers: { Authorization: bearerToken({ 'custom:organizationID': 'org-1' }) } }),
        body: { runtimeTaskSource: 'manualSystem' },
      });
      expectValidationError(() => validateCreateRuntimeTaskRequest(req), 422, 'VALIDATION_ERROR');
    });
  });

  describe('validateGenerateCarePlanTasksRequest', () => {
    it('builds createdBy from actorId when present', () => {
      const req = baseReq({
        body: { actorId: 'care-plan-runtime', patientId: 'pat-1' },
      });
      validateGenerateCarePlanTasksRequest(req);
      const validated = (req as { validatedGenerateCarePlanTasks?: { createdBy: string } })
        .validatedGenerateCarePlanTasks;
      expect(validated?.createdBy).toBe('system:care-plan-runtime:care-plan-runtime');
    });

    it('uses default care plan actor when actorId absent', () => {
      const req = baseReq({ body: { patientId: 'pat-1' } });
      validateGenerateCarePlanTasksRequest(req);
      const validated = (req as { validatedGenerateCarePlanTasks?: { createdBy: string } })
        .validatedGenerateCarePlanTasks;
      expect(validated?.createdBy).toBe('system:care-plan-runtime');
    });
  });

  describe('validateGetRuntimeTaskRequest', () => {
    it('parses includeRelated=false', () => {
      const req = baseReq({
        event: baseEvent({
          pathParameters: { runtimeTaskInstanceId: 'rtask-1' },
        }),
        params: { includeRelated: 'false' },
      });
      validateGetRuntimeTaskRequest(req);
      expect((req as { validatedGetRuntimeTask?: { includeRelated: boolean } }).validatedGetRuntimeTask)
        .toMatchObject({ runtimeTaskInstanceId: 'rtask-1', includeRelated: false });
    });

    it('throws when runtimeTaskInstanceId missing', () => {
      const req = baseReq();
      expectValidationError(() => validateGetRuntimeTaskRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('throws when runtimeTaskInstanceId is empty string', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: '' } }),
      });
      expectValidationError(() => validateGetRuntimeTaskRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({
          headers: {},
          pathParameters: { runtimeTaskInstanceId: 'rtask-1' },
        }),
        context: {
          correlationId: 'corr-1',
          awsRequestId: 'aws-1',
          authHeader: undefined,
          logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      });
      expectValidationError(() => validateGetRuntimeTaskRequest(req), 401, 'UNAUTHORIZED');
    });

    it('defaults includeRelated to true', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: 'rtask-1' } }),
        params: { includeRelated: 'true' },
      });
      validateGetRuntimeTaskRequest(req);
      expect((req as { validatedGetRuntimeTask?: { includeRelated: boolean } }).validatedGetRuntimeTask?.includeRelated)
        .toBe(true);
    });

    it('resolves org from authorizer for get runtime task', () => {
      const req = reqWithAuthorizer(
        { organizationID: 'org-auth' },
        {
          event: baseEvent({
            requestContext: { authorizer: { organizationID: 'org-auth' } },
            headers: {},
            pathParameters: { runtimeTaskInstanceId: 'rtask-1' },
          }),
        },
      );
      validateGetRuntimeTaskRequest(req);
      expect((req as { validatedGetRuntimeTask?: { orgId: string } }).validatedGetRuntimeTask?.orgId).toBe('org-auth');
    });
  });

  describe('validateGetRuntimeTaskHistoryRequest', () => {
    it('parses pageSize and nextToken', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: 'rtask-1' } }),
        params: { pageSize: '10', nextToken: ' tok ' },
      });
      validateGetRuntimeTaskHistoryRequest(req);
      expect((req as { validatedGetRuntimeTaskHistory?: { pageSize: number; nextToken?: string } })
        .validatedGetRuntimeTaskHistory).toMatchObject({ pageSize: 10, nextToken: 'tok' });
    });

    it('rejects invalid pageSize', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: 'rtask-1' } }),
        params: { pageSize: '0' },
      });
      expectValidationError(() => validateGetRuntimeTaskHistoryRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({
          headers: {},
          pathParameters: { runtimeTaskInstanceId: 'rtask-1' },
        }),
        context: {
          correlationId: 'corr-1',
          awsRequestId: 'aws-1',
          authHeader: undefined,
          logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      });
      expectValidationError(() => validateGetRuntimeTaskHistoryRequest(req), 401, 'UNAUTHORIZED');
    });

    it('uses default pageSize when query param blank', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: 'rtask-1' } }),
        params: { pageSize: '   ' },
      });
      validateGetRuntimeTaskHistoryRequest(req);
      expect(
        (req as { validatedGetRuntimeTaskHistory?: { pageSize: number } }).validatedGetRuntimeTaskHistory?.pageSize,
      ).toBe(50);
    });

    it('rejects non-integer pageSize', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: 'rtask-1' } }),
        params: { pageSize: '10.5' },
      });
      expectValidationError(() => validateGetRuntimeTaskHistoryRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('rejects pageSize above max', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: 'rtask-1' } }),
        params: { pageSize: '999' },
      });
      expectValidationError(() => validateGetRuntimeTaskHistoryRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('rejects negative pageSize', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: 'rtask-1' } }),
        params: { pageSize: '-1' },
      });
      expectValidationError(() => validateGetRuntimeTaskHistoryRequest(req), 400, 'VALIDATION_ERROR');
    });
  });

  describe('validateGetTasksRequest', () => {
    it('parses optional filters', () => {
      const req = baseReq({
        params: {
          patientId: 'pat-1',
          workflowStage: 'ongoing',
          currentState: 'open',
        },
      });
      validateGetTasksRequest(req);
      expect((req as { validatedGetTasks?: { workflowStage?: string; currentState?: string } }).validatedGetTasks)
        .toMatchObject({ patientId: 'pat-1', workflowStage: 'ongoing', currentState: 'open' });
    });

    it('throws when patientId missing', () => {
      expectValidationError(() => validateGetTasksRequest(baseReq()), 400, 'VALIDATION_ERROR');
    });

    it('throws when patientId is blank', () => {
      const req = baseReq({ params: { patientId: '   ' } });
      expectValidationError(() => validateGetTasksRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({ headers: { Authorization: bearerToken({}) } }),
        params: { patientId: 'pat-1' },
      });
      expectValidationError(() => validateGetTasksRequest(req), 401, 'UNAUTHORIZED');
    });

    it('rejects invalid workflowStage', () => {
      const req = baseReq({ params: { patientId: 'pat-1', workflowStage: 'invalid' } });
      expectValidationError(() => validateGetTasksRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('uses default pageSize when omitted', () => {
      const req = baseReq({ params: { patientId: 'pat-1' } });
      validateGetTasksRequest(req);
      expect((req as { validatedGetTasks?: { pageSize: number } }).validatedGetTasks?.pageSize).toBe(50);
    });

    it('rejects pageSize above max', () => {
      const req = baseReq({ params: { patientId: 'pat-1', pageSize: '500' } });
      expectValidationError(() => validateGetTasksRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('rejects invalid currentState', () => {
      const req = baseReq({ params: { patientId: 'pat-1', currentState: 'bogus' } });
      expectValidationError(() => validateGetTasksRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({ headers: {} }),
        context: {
          correlationId: 'corr-1',
          awsRequestId: 'aws-1',
          authHeader: undefined,
          logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        params: { staffUserId: 'user-1' },
      });
      expectValidationError(() => validateGetStaffTasksRequest(req), 401, 'UNAUTHORIZED');
    });

    it('ignores blank optional enum query params', () => {
      const req = baseReq({ params: { patientId: 'pat-1', workflowStage: '   ', currentState: '  ' } });
      validateGetTasksRequest(req);
      expect((req as { validatedGetTasks?: { workflowStage?: string; currentState?: string } }).validatedGetTasks)
        .toMatchObject({ workflowStage: undefined, currentState: undefined });
    });

    it('parses nextToken trimming whitespace', () => {
      const req = baseReq({ params: { patientId: 'pat-1', nextToken: '  cursor-1  ' } });
      validateGetTasksRequest(req);
      expect((req as { validatedGetTasks?: { nextToken?: string } }).validatedGetTasks?.nextToken).toBe('cursor-1');
    });
  });

  describe('validateGetStaffTasksRequest', () => {
    it('requires staffUserId to match authenticated user', () => {
      const req = baseReq({
        params: { staffUserId: 'user-1' },
      });
      validateGetStaffTasksRequest(req);
      expect((req as { validatedGetStaffTasks?: { staffUserId: string } }).validatedGetStaffTasks?.staffUserId).toBe(
        'user-1',
      );
    });

    it('resolves staff user from authorizer claims', () => {
      const req = reqWithAuthorizer(
        { organizationID: 'org-1', userID: 'staff-77' },
        { params: { staffUserId: 'staff-77' } },
      );
      validateGetStaffTasksRequest(req);
      expect((req as { validatedGetStaffTasks?: { staffUserId: string } }).validatedGetStaffTasks?.staffUserId).toBe(
        'staff-77',
      );
    });

    it('throws 403 when staffUserId mismatches token', () => {
      const req = baseReq({ params: { staffUserId: 'other-staff' } });
      expectValidationError(() => validateGetStaffTasksRequest(req), 403, 'FORBIDDEN');
    });

    it('throws when staffUserId missing', () => {
      expectValidationError(() => validateGetStaffTasksRequest(baseReq()), 400, 'VALIDATION_ERROR');
    });

    it('throws 401 when authenticated user missing', () => {
      const req = baseReq({
        event: baseEvent({ headers: { Authorization: bearerToken({ 'custom:organizationID': 'org-1' }) } }),
        params: { staffUserId: 'staff-1' },
      });
      expectValidationError(() => validateGetStaffTasksRequest(req), 401, 'UNAUTHORIZED');
    });

    it('rejects invalid currentState filter', () => {
      const req = baseReq({ params: { staffUserId: 'user-1', currentState: 'bogus' } });
      expectValidationError(() => validateGetStaffTasksRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('uses default pageSize when omitted', () => {
      const req = baseReq({ params: { staffUserId: 'user-1' } });
      validateGetStaffTasksRequest(req);
      expect((req as { validatedGetStaffTasks?: { pageSize: number } }).validatedGetStaffTasks?.pageSize).toBe(50);
    });

    it('rejects pageSize above max', () => {
      const req = baseReq({ params: { staffUserId: 'user-1', pageSize: '999' } });
      expectValidationError(() => validateGetStaffTasksRequest(req), 400, 'VALIDATION_ERROR');
    });
  });

  describe('validateGetActionCenterItemsRequest', () => {
    it('defaults timezone when omitted', () => {
      const req = baseReq({
        params: { patientId: 'pat-1', surfaceSection: 'all' },
      });
      validateGetActionCenterItemsRequest(req);
      expect(
        (req as { validatedGetActionCenterItems?: { timezone: string } }).validatedGetActionCenterItems?.timezone,
      ).toBe('UTC');
    });

    it('throws when surfaceSection missing', () => {
      const req = baseReq({ params: { patientId: 'pat-1' } });
      expectValidationError(() => validateGetActionCenterItemsRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('throws when surfaceSection invalid', () => {
      const req = baseReq({ params: { patientId: 'pat-1', surfaceSection: 'bogus' } });
      expectValidationError(() => validateGetActionCenterItemsRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('throws when timezone invalid', () => {
      const req = baseReq({
        params: { patientId: 'pat-1', surfaceSection: 'today', timezone: 'Not/A/Zone' },
      });
      expectValidationError(() => validateGetActionCenterItemsRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({ headers: { Authorization: bearerToken({}) } }),
        params: { patientId: 'pat-1', surfaceSection: 'all' },
      });
      expectValidationError(() => validateGetActionCenterItemsRequest(req), 401, 'UNAUTHORIZED');
    });

    it('rejects pageSize above max', () => {
      const req = baseReq({
        params: { patientId: 'pat-1', surfaceSection: 'all', pageSize: '999' },
      });
      expectValidationError(() => validateGetActionCenterItemsRequest(req), 400, 'VALIDATION_ERROR');
    });
  });

  describe('validateUpdateAssignedStaffRequest', () => {
    it('requires runtimeTaskInstanceId path param', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: 'rtask-1' } }),
        body: { actorId: 'mgr-1', assignedToStaffId: 'staff-2' },
      });
      validateUpdateAssignedStaffRequest(req);
      expect(
        (req as { validatedUpdateAssignedStaff?: { runtimeTaskInstanceId: string } }).validatedUpdateAssignedStaff
          ?.runtimeTaskInstanceId,
      ).toBe('rtask-1');
    });

    it('throws when path param missing', () => {
      expectValidationError(() => validateUpdateAssignedStaffRequest(baseReq({ body: {} })), 400, 'VALIDATION_ERROR');
    });

    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({
          headers: { Authorization: bearerToken({}) },
          pathParameters: { runtimeTaskInstanceId: 'rtask-1' },
        }),
        body: { actorId: 'mgr-1', assignedToStaffId: 'staff-2' },
      });
      expectValidationError(() => validateUpdateAssignedStaffRequest(req), 401, 'UNAUTHORIZED');
    });
  });

  describe('validateUpdateTaskStateRequest', () => {
    it('attaches validated update payload', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: 'rtask-1' } }),
        body: {
          action: 'complete',
          actorId: 'pat-1',
          actorType: 'patient',
          expectedCurrentState: 'open',
        },
      });
      validateUpdateTaskStateRequest(req);
      expect((req as { validatedUpdateTaskState?: { body: { action: string } } }).validatedUpdateTaskState?.body.action)
        .toBe('complete');
    });

    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({
          headers: { Authorization: bearerToken({}) },
          pathParameters: { runtimeTaskInstanceId: 'rtask-1' },
        }),
        body: { action: 'complete', actorId: 'pat-1', actorType: 'patient', expectedCurrentState: 'open' },
      });
      expectValidationError(() => validateUpdateTaskStateRequest(req), 401, 'UNAUTHORIZED');
    });

    it('throws when runtimeTaskInstanceId missing', () => {
      expectValidationError(() => validateUpdateTaskStateRequest(baseReq({ body: {} })), 400, 'VALIDATION_ERROR');
    });
  });

  describe('validateGetTaskStatusSummaryRequest', () => {
    it('parses workflowStage when provided', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { carePlanInstanceId: 'cp-1' } }),
        params: { patientId: 'pat-1', workflowStage: 'onboarding' },
      });
      validateGetTaskStatusSummaryRequest(req);
      expect(
        (req as { validatedGetTaskStatusSummary?: { workflowStage?: string } }).validatedGetTaskStatusSummary,
      ).toMatchObject({ carePlanInstanceId: 'cp-1', workflowStage: 'onboarding' });
    });

    it('throws when patientId missing', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { carePlanInstanceId: 'cp-1' } }),
      });
      expectValidationError(() => validateGetTaskStatusSummaryRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('throws when carePlanInstanceId missing', () => {
      const req = baseReq({ params: { patientId: 'pat-1' } });
      expectValidationError(() => validateGetTaskStatusSummaryRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('throws when carePlanInstanceId is blank', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { carePlanInstanceId: '   ' } }),
        params: { patientId: 'pat-1' },
      });
      expectValidationError(() => validateGetTaskStatusSummaryRequest(req), 400, 'VALIDATION_ERROR');
    });

    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({
          headers: { Authorization: bearerToken({ 'custom:userID': 'u1' }) },
          pathParameters: { carePlanInstanceId: 'cp-1' },
        }),
        params: { patientId: 'pat-1' },
      });
      expectValidationError(() => validateGetTaskStatusSummaryRequest(req), 401, 'UNAUTHORIZED');
    });
    it('rejects invalid workflowStage on status summary', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { carePlanInstanceId: 'cp-1' } }),
        params: { patientId: 'pat-1', workflowStage: 'invalid-stage' },
      });
      expectValidationError(() => validateGetTaskStatusSummaryRequest(req), 400, 'VALIDATION_ERROR');
    });
  });

  describe('validateUpdateReminderSettingsRequest', () => {
    it('attaches validated reminder settings', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: 'rtask-1' } }),
        body: { actorId: 'staff-1', reminderEnabled: true },
      });
      validateUpdateReminderSettingsRequest(req);
      expect(
        (req as { validatedUpdateReminderSettings?: { runtimeTaskInstanceId: string } })
          .validatedUpdateReminderSettings?.runtimeTaskInstanceId,
      ).toBe('rtask-1');
    });

    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({
          headers: { Authorization: bearerToken({}) },
          pathParameters: { runtimeTaskInstanceId: 'rtask-1' },
        }),
        body: { actorId: 'staff-1', reminderEnabled: true },
      });
      expectValidationError(() => validateUpdateReminderSettingsRequest(req), 401, 'UNAUTHORIZED');
    });

    it('throws when runtimeTaskInstanceId missing', () => {
      expectValidationError(() => validateUpdateReminderSettingsRequest(baseReq({ body: {} })), 400, 'VALIDATION_ERROR');
    });
  });

  describe('validateUpdateRuntimeTaskRequest', () => {
    it('builds patch from body fields', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: 'rtask-1' } }),
        body: { actorId: 'staff-1', displayTitle: 'New title', reason: 'edit' },
      });
      validateUpdateRuntimeTaskRequest(req);
      const validated = (req as { validatedUpdateRuntimeTask?: { patch: { displayTitle?: string } } })
        .validatedUpdateRuntimeTask;
      expect(validated?.patch).toEqual({ displayTitle: 'New title' });
    });

    it('includes every provided metadata field in patch', () => {
      const req = baseReq({
        event: baseEvent({ pathParameters: { runtimeTaskInstanceId: 'rtask-1' } }),
        body: {
          actorId: 'staff-1',
          displayTitle: 'New title',
          displayToPatient: true,
          workflowStage: 'ongoing',
        },
      });
      validateUpdateRuntimeTaskRequest(req);
      const patch = (req as { validatedUpdateRuntimeTask?: { patch: Record<string, unknown> } })
        .validatedUpdateRuntimeTask?.patch;
      expect(patch).toMatchObject({
        displayTitle: 'New title',
        displayToPatient: true,
        workflowStage: 'ongoing',
      });
    });

    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({
          headers: { Authorization: bearerToken({}) },
          pathParameters: { runtimeTaskInstanceId: 'rtask-1' },
        }),
        body: { actorId: 'staff-1', displayTitle: 'New title' },
      });
      expectValidationError(() => validateUpdateRuntimeTaskRequest(req), 401, 'UNAUTHORIZED');
    });

    it('throws when runtimeTaskInstanceId missing', () => {
      expectValidationError(() => validateUpdateRuntimeTaskRequest(baseReq({ body: {} })), 400, 'VALIDATION_ERROR');
    });
  });

  describe('validateGenerateCarePlanTasksRequest auth', () => {
    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({ headers: { Authorization: bearerToken({}) } }),
        body: { patientId: 'pat-1' },
      });
      expectValidationError(() => validateGenerateCarePlanTasksRequest(req), 401, 'UNAUTHORIZED');
    });
  });

  describe('validateCreateRuntimeTaskRequest auth', () => {
    it('throws 401 when org missing', () => {
      const req = baseReq({
        event: baseEvent({ headers: { Authorization: bearerToken({}) } }),
        body: { runtimeTaskSource: 'serviceFlowRuntime' },
      });
      expectValidationError(() => validateCreateRuntimeTaskRequest(req), 401, 'UNAUTHORIZED');
    });
  });
});
