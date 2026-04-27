/**
 * HTTP controllers for alert-service.
 *
 * **HTTP → `getAlertService` → `AlertService` (`@api-hub/alert-integration`) → `AlertRepository`**
 *
 * **Create:** mirrors sso `AppointmentSyncController` — `handleCreateAlert(event, context?)` builds the request,
 * runs validation, returns `ApiResponse` / `handleError` results (full `APIGatewayProxyResult`).
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  extractCorrelationId,
  serializeError,
} from '@api-hub/logger';
import type { AppError, LambdaRequest, ResponseOptions } from '@api-hub/utils';
import { ApiResponse, buildRequestContext, handleError } from '@api-hub/utils';
import type { AlertState, CreateAlertInput } from '@api-hub/alert-integration';
import { toAlertDetail, toPublicAlert } from '@api-hub/alert-integration';
import { getAlertService } from '../services/alert-app.service';
import { patchAlertBodySchema, type CreateAlertRequest } from '../validators/alert.schemas';
import { validateCreateAlertRequest, type ValidatedCreateAlert } from '../validation/request.validators';

const controllerBaseLogger = createLogger({ service: 'alert-service', redactPII: true });

let ctrl: AlertHttpController | undefined;

function toServiceInput(orgId: string, actorUserId: string | undefined, body: CreateAlertRequest): CreateAlertInput {
  return {
    organizationId: orgId,
    actorUserId,
    inputEventId: body.inputEventId,
    inputType: body.inputType,
    sourceType: body.sourceType,
    patientId: body.patientId,
    carePlanInstanceId: body.carePlanInstanceId,
    packageAssignmentId: body.packageAssignmentId,
    triggerTimestamp: body.triggerTimestamp,
    appliesToType: body.appliesToType,
    linkedEntityCode: body.linkedEntityCode,
    severityHint: body.severityHint,
    priority: body.priority,
    alertPolicyTemplateVersionId: body.alertPolicyTemplateVersionId,
    thresholdTemplateVersionId: body.thresholdTemplateVersionId,
    groupingKey: body.groupingKey,
    triggerSummary: body.triggerSummary,
    triggerSummaryTemplateCode: body.triggerSummaryTemplateCode,
    triggerSummaryParams: body.triggerSummaryParams,
    evidencePayload: body.evidencePayload,
  };
}

export class AlertHttpController {
  private readonly svc = getAlertService();
  private readonly errSeverity = 'ERROR' as const;
  private readonly okSeverity = 'SUCCESS' as const;

  private getCorrelationId(req: LambdaRequest): string {
    return (
      (req.context as { correlationId?: string }).correlationId ??
      req.context.awsRequestId ??
      'unknown'
    );
  }

  private getResponseOptions(req: LambdaRequest, extraHeaders?: Record<string, string>): ResponseOptions {
    const correlationId = this.getCorrelationId(req);
    return {
      requestId: correlationId,
      event: req.event,
      headers: {
        'X-Correlation-Id': correlationId,
        'Cache-Control': 'no-store',
        ...extraHeaders,
      },
    };
  }

  private mapServiceLayerError(
    req: LambdaRequest,
    error: unknown,
    opts: ResponseOptions,
    logCtx: { organizationId?: string; logEvent?: string },
  ): APIGatewayProxyResult {
    const correlationId = this.getCorrelationId(req);
    const err = error as Error & { statusCode?: number; code?: string };
    const msg = err.message ?? 'Unexpected error';
    const status = err.statusCode;

    if (err.code === 'IDEMPOTENCY_KEY_IN_USE' && status === 409) {
      return ApiResponse.conflict(
        { title: 'Conflict', description: err.message, severity: this.errSeverity },
        opts,
        { code: err.code, details: [{ message: err.message }] },
      );
    }

    if (status === 404) {
      return ApiResponse.badRequest(
        { title: 'Bad request', description: msg, severity: this.errSeverity },
        opts,
        { code: 'BAD_REQUEST', details: [{ message: msg }] },
      );
    }
    if (status === 502) {
      return ApiResponse.error(
        502,
        { title: 'Bad gateway', description: 'Upstream service error', severity: this.errSeverity },
        opts,
        { code: 'UPSTREAM_ERROR', details: [{ message: msg }] },
      );
    }
    if (status != null && status >= 400 && status < 500) {
      return ApiResponse.error(
        status,
        { title: 'Error', description: msg, severity: this.errSeverity },
        opts,
        { code: err.code ?? 'ERROR', details: [{ message: msg }] },
      );
    }

    const logEvent = logCtx.logEvent ?? 'alert_controller_error';
    req.context.logger?.error({
      event: logEvent,
      correlationId,
      ...(logCtx.organizationId ? { organizationId: logCtx.organizationId } : {}),
      err: serializeError(error as Error),
    });

    return ApiResponse.internalServerError(
      {
        title: 'Internal server error',
        description: 'An unexpected error occurred',
        severity: this.errSeverity,
      },
      opts,
      { code: 'INTERNAL_ERROR', details: [{ message: 'An unexpected error occurred' }] },
    );
  }

  /**
   * POST /alerts — same pattern as sso `handleSyncAppointments`: receive raw `APIGatewayProxyEvent`, child logger,
   * `buildRequestContext` + `validateCreateAlertRequest`, then `ApiResponse` (201 / 409) or `mapServiceLayerError`.
   */
  async handleCreateAlert(
    event: APIGatewayProxyEvent,
    context?: Context,
  ): Promise<APIGatewayProxyResult> {
    const correlationId = extractCorrelationId(event) || context?.awsRequestId || 'unknown';
    const awsRequestId = context ? extractAwsRequestId(context) : (event.requestContext?.requestId ?? 'unknown');

    const requestLogger = createChildLogger(controllerBaseLogger, {
      correlationId,
      awsRequestId,
      component: 'AlertHttpController',
    });

    const request = buildRequestContext(event) as LambdaRequest;
    Object.assign(request.context as object, { logger: requestLogger, correlationId, awsRequestId });

    try {
      validateCreateAlertRequest(request);
    } catch (e) {
      return await handleError(e as AppError, { correlationId, logger: requestLogger, event });
    }

    const opts = this.getResponseOptions(request);
    const v = (request as LambdaRequest & { validatedCreateAlert?: ValidatedCreateAlert }).validatedCreateAlert;
    if (!v) {
      return ApiResponse.internalServerError(
        {
          title: 'Internal server error',
          description: 'Request was not validated before controller',
          severity: this.errSeverity,
        },
        opts,
        { code: 'INTERNAL_ERROR', details: [{ message: 'Request was not validated before controller' }] },
      );
    }

    const createInput = toServiceInput(v.orgId, v.actorUserId, v.body);
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
          opts,
        );
      }
      return ApiResponse.created(
        data,
        { title: 'SUCCESS', description: 'Alert created', severity: this.okSeverity },
        this.getResponseOptions(request, { Location: location }),
      );
    } catch (e: unknown) {
      return this.mapServiceLayerError(request, e, opts, {
        organizationId: v.orgId,
        logEvent: 'create_alert_error',
      });
    }
  }

  async handleGetAlert(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) throw Object.assign(new Error('alertId required'), { statusCode: 400 });
    const row = await this.svc.getAlert(alertId);
    if (!row) throw Object.assign(new Error('Alert not found'), { statusCode: 404 });
    return { alert: toPublicAlert(row) };
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
