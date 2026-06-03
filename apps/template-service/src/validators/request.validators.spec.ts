import type { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaRequest } from '@api-hub/utils';

import { bearerToken } from '../__tests__/handler-test-utils';
import { validateCreateMasterRequest } from './request.validators';

function createRequest(body: Record<string, unknown>): LambdaRequest {
  return {
    event: {
      headers: {
        Authorization: bearerToken({
          'custom:organizationID': 'ROOT',
          'custom:userID': '88a9a6e052092188660a404a303ca34c992caabfccfc184ca2121fcac2d84e7f',
        }),
      },
    } as unknown as APIGatewayProxyEvent,
    params: {},
    body,
    pathParameters: {},
    context: {
      correlationId: 'test',
      authHeader: bearerToken({
        'custom:organizationID': 'ROOT',
        'custom:userID': '88a9a6e052092188660a404a303ca34c992caabfccfc184ca2121fcac2d84e7f',
      }),
    },
  } as unknown as LambdaRequest;
}

describe('validateCreateMasterRequest', () => {
  it('normalizes UI payload with TEMPLATE_NAME and fieldValues (no templateCode)', async () => {
    const req = createRequest({
      templateLevel: 'MASTER',
      templateType: 'TASK',
      TEMPLATE_NAME: 'Task Monitoring Master',
      status: 'DRAFT',
      fieldValues: {
        categoryCode: 'CHRONIC_CARE',
        conditionCode: 'DIABETES',
        shareScope: 'private',
        TASK_NAME: 'Record Blood Pressure',
        TASK_DESCRIPTION: 'Measure BP daily',
        ASSIGNED_TO_ROLE: 'PATIENT',
        TASK_CATEGORY: 'MONITORING',
        TASK_TYPE: 'MEASUREMENT',
        TASK_SUBTYPE: 'BLOOD_PRESSURE',
        ACTION_SUBMISSION_TYPE: 'DEVICE_SYNC',
        COMPARISON_METHOD: 'RANGE',
        SCHEDULE_TYPE: 'RECURRING',
        RECURRENCE_PATTERN: 'DAILY',
        REMINDERS_ENABLED: true,
        REMINDER_CHANNELS: ['IN_APP', 'PUSH'],
        DISPLAY_TO_PATIENT: true,
      },
    });

    await validateCreateMasterRequest(req);

    const validated = (
      req as LambdaRequest & {
        validatedCreateMaster?: {
          body: Record<string, unknown>;
        };
      }
    ).validatedCreateMaster;

    expect(validated?.body.templateName).toBe('Task Monitoring Master');
    expect(validated?.body.templateCode).toBe('TASK-MONITORING-MASTER');
    expect(validated?.body.templateType).toBe('TASK');
    expect(validated?.body.status).toBe('DRAFT');
    expect(validated?.body.shareScope).toBeUndefined();
    expect(validated?.body.category).toBeUndefined();
    expect(validated?.body.condition).toBeUndefined();
    expect(validated?.body.fieldValues).toEqual(
      expect.objectContaining({
        categoryCode: 'CHRONIC_CARE',
        conditionCode: 'DIABETES',
        shareScope: 'PRIVATE',
        TASK_NAME: 'Record Blood Pressure',
        REMINDER_CHANNELS: ['IN_APP', 'PUSH'],
      }),
    );
  });
});
