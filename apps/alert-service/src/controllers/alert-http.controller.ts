/**
 * HTTP controllers for alert-service.
 *
 * **HTTP → `getAlertService` → `AlertService` (`@api-hub/alert-integration`) → `AlertRepository`**
 *
 * **Responses:** {@link apiGatewayResponseOptions} from `@api-hub/utils` (same defaults as SSO `BaseController.errorResponse`).
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createChildLogger, createLogger } from '@api-hub/logger';
import type { AppError, LambdaRequest } from '@api-hub/utils';
import { ApiResponse, apiGatewayResponseOptions, buildRequestContext, handleError } from '@api-hub/utils';
import type { AlertState, CreateAlertPayload } from '@api-hub/alert-integration';
import { toAlertDetail, toPublicAlert } from '@api-hub/alert-integration';
import type { AlertActivityExclusiveStartKey } from '@api-hub/alert-repository';
import { getAlertService } from '../services/alert-app.service';
import { patchAlertBodySchema, type CreateAlertHttpBody } from '../validators/alert.schemas';
import { validateCreateAlertRequest, type ValidatedCreateAlert } from '../validation/request.validators';
import {
  getAuthorizationForGatewayEvent,
  getLambdaInvocationMeta,
  getOrganizationIdForRequest,
} from '../utils/helpers';
import { normalizeAlertServiceError } from '../utils/alert-http-errors';

const controllerBaseLogger = createLogger({ service: 'alert-service', redactPII: true });

let ctrl: AlertHttpController | undefined;

function buildCreateAlertPayload(
  orgId: string,
  actorUserId: string | undefined,
  body: CreateAlertHttpBody,
): CreateAlertPayload {
  const ev = body.evidencePayload;
  return {
    organizationId: orgId,
    actorUserId,
    ...body,
    appliesToType: ev.appliesToType,
    linkedEntityCode: ev.linkedEntityCode,
    evidencePayload: { ...ev },
  };
}

export class AlertHttpController {
  private readonly svc = getAlertService();
  private readonly errSeverity = 'ERROR' as const;
  private readonly okSeverity = 'SUCCESS' as const;

  /**
   * POST /alerts — validation → `AlertService`; errors via {@link normalizeAlertServiceError} + {@link handleError}.
   */
  async handleCreateAlert(
    event: APIGatewayProxyEvent,
    context?: Context,
  ): Promise<APIGatewayProxyResult> {
    const { correlationId, awsRequestId } = getLambdaInvocationMeta(event, context);

    const requestLogger = createChildLogger(controllerBaseLogger, {
      correlationId,
      awsRequestId,
      component: 'AlertHttpController',
    });

    const request = buildRequestContext(event) as LambdaRequest;
    const ctx = request.context as { authHeader?: string };
    const resolvedAuthHeader = getAuthorizationForGatewayEvent(event) ?? ctx.authHeader;
    Object.assign(request.context as object, {
      logger: requestLogger,
      correlationId,
      awsRequestId,
      authHeader: resolvedAuthHeader,
    });

    try {
      validateCreateAlertRequest(request);
    } catch (e) {
      return await handleError(e as AppError, {
        correlationId,
        logger: requestLogger,
        event,
      });
    }

    const errorOpts = apiGatewayResponseOptions(correlationId);
    const v = (request as LambdaRequest & { validatedCreateAlert?: ValidatedCreateAlert }).validatedCreateAlert;
    if (!v) {
      return ApiResponse.internalServerError(
        {
          title: 'Internal server error',
          description: 'Request was not validated before controller',
          severity: this.errSeverity,
        },
        errorOpts,
        { code: 'INTERNAL_ERROR', details: [{ message: 'Request was not validated before controller' }] },
      );
    }

    const createInput = buildCreateAlertPayload(v.orgId, v.actorUserId, v.body);
    const authHeader = v.authHeader;

    try {
      const { record, duplicate } = await this.svc.createAlert(createInput, authHeader);
      const data = toAlertDetail(record);
      const location = `/alerts/${record.alertId}`;
      if (duplicate) {
        return ApiResponse.conflictWithData(
          data,
          {
            title: 'Conflict',
            description:
              'An alert for this idempotency key (inputEventId) already exists in this organization.',
            severity: 'WARNING',
          },
          apiGatewayResponseOptions(correlationId),
        );
      }
      return ApiResponse.created(
        data,
        { title: 'SUCCESS', description: 'Alert created', severity: this.okSeverity },
        apiGatewayResponseOptions(correlationId, { Location: location }),
      );
    } catch (e: unknown) {
      try {
        normalizeAlertServiceError(e, {
          logger: requestLogger,
          correlationId,
          organizationId: v.orgId,
          logEvent: 'create_alert_error',
        });
      } catch (appErr) {
        return await handleError(appErr as AppError, {
          correlationId,
          logger: requestLogger,
          event,
        });
      }
    }
  }

  async handleGetAlert(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) throw Object.assign(new Error('alertId required'), { statusCode: 400 });
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(req.event, authHeader);
    if (!orgId) {
      const e = new Error('Organization could not be resolved from the access token') as Error & {
        statusCode: number;
        code?: string;
      };
      e.statusCode = 401;
      e.code = 'UNAUTHORIZED';
      throw e;
    }
    const row = await this.svc.getAlert(alertId, orgId);
    if (!row) throw Object.assign(new Error('Alert not found'), { statusCode: 404 });
    return toAlertDetail(row);
  }

  async handleGetAlertActivity(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) throw Object.assign(new Error('alertId required'), { statusCode: 400 });
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(req.event, authHeader);
    if (!orgId) {
      const e = new Error('Organization could not be resolved from the access token') as Error & {
        statusCode: number;
        code?: string;
      };
      e.statusCode = 401;
      e.code = 'UNAUTHORIZED';
      throw e;
    }
    const qp = req.params as Record<string, string | undefined>;
    const activityType = qp.activityType?.trim() || undefined;
    const pageSizeRaw = qp.pageSize;
    const pageSize =
      pageSizeRaw !== undefined && pageSizeRaw !== '' ? Number(pageSizeRaw) : undefined;
    if (
      pageSize !== undefined &&
      (Number.isNaN(pageSize) || !Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100)
    ) {
      throw Object.assign(new Error('pageSize must be between 1 and 100'), { statusCode: 400 });
    }

    let exclusiveStartKey: AlertActivityExclusiveStartKey | undefined;
    if (qp.nextToken) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(qp.nextToken, 'base64url').toString('utf8'),
        ) as AlertActivityExclusiveStartKey;
      } catch {
        throw Object.assign(new Error('Invalid nextToken'), { statusCode: 400 });
      }
    }

    const page = await this.svc.listAlertActivity(alertId, orgId, {
      activityType,
      pageSize,
      exclusiveStartKey,
    });
    if (!page) throw Object.assign(new Error('Alert not found'), { statusCode: 404 });

    const nextToken = page.lastEvaluatedKey
      ? Buffer.from(JSON.stringify(page.lastEvaluatedKey), 'utf8').toString('base64url')
      : undefined;

    return {
      items: page.items,
      ...(nextToken ? { nextToken } : {}),
    };
  }

  async handleListPatientAlerts(req: LambdaRequest) {
    const patientId = req.pathParameters?.patientId;
    if (!patientId) throw Object.assign(new Error('patientId required'), { statusCode: 400 });
    const qp = req.params as Record<string, string | undefined>;
    const openOnly = qp.openOnly === 'true' || qp.openOnly === '1';
    const inputType = qp.inputType;
    const limit = qp.limit ? Number(qp.limit) : 50;
    const rows = await this.svc.listPatientAlerts(patientId, { openOnly, inputType, limit });
    return { items: rows.map(toPublicAlert) };
  }

  async handleListOrgAlerts(req: LambdaRequest) {
    const organizationId = req.pathParameters?.organizationId;
    if (!organizationId) throw Object.assign(new Error('organizationId required'), { statusCode: 400 });
    const qp = req.params as Record<string, string | undefined>;
    const state = (qp.state as AlertState | undefined) ?? 'UNASSIGNED';
    const unassignedOnly = qp.unassignedOnly === 'true' || qp.unassignedOnly === '1';
    const limit = qp.limit ? Number(qp.limit) : 50;
    const rows = await this.svc.listOrgAlerts(organizationId, { state, unassignedOnly, limit });
    return { items: rows.map(toPublicAlert) };
  }

  async handleListUserAlerts(req: LambdaRequest) {
    const userId = req.pathParameters?.userId;
    if (!userId) throw Object.assign(new Error('userId required'), { statusCode: 400 });
    const qp = req.params as Record<string, string | undefined>;
    const state = qp.state as AlertState | undefined;
    const limit = qp.limit ? Number(qp.limit) : 50;
    const rows = await this.svc.listUserAlerts(userId, { state, limit });
    return { items: rows.map(toPublicAlert) };
  }

  async handlePatchAlert(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) throw Object.assign(new Error('alertId required'), { statusCode: 400 });
    const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {};
    const patch = patchAlertBodySchema.parse(raw) as {
      alertState?: AlertState;
      assignedToUserId?: string | null;
      slaBreachIndicator?: boolean;
    };
    const row = await this.svc.updateAlert(alertId, patch);
    if (!row) throw Object.assign(new Error('Alert not found'), { statusCode: 404 });
    return { alert: toPublicAlert(row) };
  }
}

export function getAlertHttpController(): AlertHttpController {
  if (!ctrl) ctrl = new AlertHttpController();
  return ctrl;
}
