import { ApiResponse } from '@api-hub/utils'
import { APIGatewayProxyEvent } from 'aws-lambda'
import {
  createChildLogger,
  extractCorrelationId,
  serializeError,
} from '@api-hub/observability'

import { BaseController } from '../core/base.controller'
import { getEnvConfig } from '../config/env'
import { checkRateLimit, getRateLimitHeaders } from '../middleware/rate-limit.middleware'
import { AppointmentSyncService } from '../services/appointment-sync.service'
import { Appointment } from '../types'
import { SSOError } from '../types/errors/sso-error'
import { getExternalTenantsByProvider } from '../services/external-tenant.service'
import { buildSSORequestContextFromTenant } from '../utils/context-builder.util'

export class AppointmentSyncController extends BaseController {

  private readonly appointmentSyncService = new AppointmentSyncService()

  async handleSyncAppointments(event: APIGatewayProxyEvent) {
    const correlationId = extractCorrelationId(event)
    const logger = createChildLogger(this.logger, {
      correlationId,
      component: 'AppointmentSyncController',
    })

      const rateLimitResult = checkRateLimit(event)
      const rateLimitHeaders = getRateLimitHeaders(rateLimitResult)

      if (!rateLimitResult.allowed) {
        return this.errorResponse(SSOError.rateLimitExceeded(), correlationId)
      }

      const serviceToken =
        event.headers.Authorization ||
        event.headers.authorization

      if (!serviceToken) {
        return this.errorResponse(
          SSOError.unauthorized('Service token is required'),
          correlationId,
        )
      }

      logger.info({
        event: 'appointment_sync_request',
        path: event.path,
        method: event.httpMethod,
        provider: getEnvConfig().PROVIDER,
      })
      
      let fromDate: string | undefined
      let toDate: string | undefined
      let appointments: Appointment[] = [];
      if (event.body) {
        try {
          const parsed = JSON.parse(event.body)
          fromDate = typeof parsed.fromDate === 'string' ? parsed.fromDate : undefined
          toDate = typeof parsed.toDate === 'string' ? parsed.toDate : undefined
          appointments = parsed.appointments ?? [];
        } catch {
          // ignore body parse errors; fallback to defaults in service
        }
      }

      try {
        const env = getEnvConfig()
        const tenants = await getExternalTenantsByProvider(env.PROVIDER)

        if (!tenants.length) {
          return this.errorResponse(
            SSOError.invalidRequest(
              `No external tenants found for provider ${env.PROVIDER}`,
            ),
            correlationId,
          )
        }

        const tenantResults: Array<{
          tenantId: string;
          status: 'success' | 'failed';
          result?: unknown;
          error?: string;
        }> = []

        const aggregate = {
          total: 0,
          synced: 0,
          skipped: 0,
          failed: 0,
          pending: 0,
        }

        for (const tenant of tenants) {
          const tenantContext = buildSSORequestContextFromTenant(tenant, correlationId)
          try {
            const result = await this.appointmentSyncService.syncAppointments(
              tenantContext,
              { fromDate, toDate },
              appointments,
            )

            aggregate.total += Number(result.total ?? result.totalAppointments ?? 0)
            aggregate.synced += Number(result.synced ?? 0)
            aggregate.skipped += Number(result.skipped ?? 0)
            aggregate.failed += Number(result.failed ?? 0)
            aggregate.pending += Number(result.pending ?? 0)

            tenantResults.push({
              tenantId: tenantContext.tenantId,
              status: 'success',
              result,
            })
          } catch (tenantError) {
            logger.error({
              event: 'appointment_sync_tenant_failed',
              tenantId: tenant.tenantId,
              provider: tenant.provider,
              err: serializeError(tenantError as Error),
            })
            tenantResults.push({
              tenantId: tenant.tenantId,
              status: 'failed',
              error: (tenantError as Error).message,
            })
          }
        }

        logger.info({
          event: 'appointment_sync_multi_tenant_complete',
          provider: env.PROVIDER,
          tenantCount: tenants.length,
          tenantFailures: tenantResults.filter((item) => item.status === 'failed').length,
          summary: aggregate,
        })

        return ApiResponse.ok(
          {
            ...aggregate,
            tenantCount: tenants.length,
            tenantResults,
          },
          {
            title: 'Success',
            description: 'Appointment sync completed for provider tenants',
            severity: 'SUCCESS'
          },
          {
            requestId: correlationId,
            headers: {
              'X-Correlation-Id': correlationId,
              'Cache-Control': 'private, max-age=60',
              ...rateLimitHeaders
            }
          }
        )
      } catch (error) {
        logger.error({
          event: 'appointment_sync_unexpected_error',
          err: serializeError(error as Error),
        })
        return this.errorResponse(
          SSOError.internalError((error as Error).message),
          correlationId,
        )
      }
  }

}

let appointmentSyncControllerInstance: AppointmentSyncController | null = null

export function getAppointmentSyncController(): AppointmentSyncController {

  if (!appointmentSyncControllerInstance) {
    appointmentSyncControllerInstance = new AppointmentSyncController()
  }

  return appointmentSyncControllerInstance
}