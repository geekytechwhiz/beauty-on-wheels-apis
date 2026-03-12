import { APIGatewayProxyEvent } from 'aws-lambda'
import { createChildLogger } from '@api-hub/logger'
import { ApiResponse } from '@api-hub/utils'

import { BaseController } from '../core/base.controller'
import { AppointmentSyncService } from '../services/appointment-sync.service'
import { checkRateLimit, getRateLimitHeaders } from '../middleware/rate-limit.middleware'
import { SSOError } from '../types/errors/sso-error'

export class AppointmentSyncController extends BaseController {

  private readonly appointmentSyncService = new AppointmentSyncService()

  async handleSyncAppointments(event: APIGatewayProxyEvent) {

    return super.execute(event, async (event, context, logger) => {

      const rateLimitResult = checkRateLimit(event)
      const rateLimitHeaders = getRateLimitHeaders(rateLimitResult)

      if (!rateLimitResult.allowed) {
        throw SSOError.rateLimitExceeded()
      }

      const serviceToken =
        event.headers.Authorization ||
        event.headers.authorization

      if (!serviceToken) {
        throw SSOError.unauthorized('Service token is required')
      }

      
      logger.info({
        event: 'appointment_sync_request',
        path: event.path,
        method: event.httpMethod,
        subdomain: context.integration.subdomain
      })

      const result =
        await this.appointmentSyncService.syncAppointments(context)

      logger.info({
        event: 'appointment_sync_success',
        doctorId: context.integration.subdomain,
        summary: {
          total: result.total ?? result.totalAppointments,
          synced: result.synced,
          skipped: result.skipped,
          failed: result.failed,
          pending: result.pending
        }
      })

      return ApiResponse.ok(
        { ...result },
        {
          title: 'Success',
          description: 'Appointment sync completed successfully',
          severity: 'SUCCESS'
        },
        {
          requestId: context.correlationId,
          headers: {
            'X-Correlation-Id': context.correlationId,
            'Cache-Control': 'private, max-age=60',
            ...rateLimitHeaders
          }
        }
      )
    })
  }

}

let appointmentSyncControllerInstance: AppointmentSyncController | null = null

export function getAppointmentSyncController(): AppointmentSyncController {

  if (!appointmentSyncControllerInstance) {
    appointmentSyncControllerInstance = new AppointmentSyncController()
  }

  return appointmentSyncControllerInstance
}