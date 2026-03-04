import { APIGatewayProxyEvent } from 'aws-lambda'

import { BaseController } from '../core/base.controller'
import { getLaunchService } from '../services/launch.service'
import { extractLaunchParams } from '../validators/sso.validator'
import { mapLaunchResponse } from '../mappers/launch-response.mapper'

export class SSOController extends BaseController {

  private readonly launchService = getLaunchService()

  async handleLaunch(event: APIGatewayProxyEvent) {

    return super.execute(event, async (event, correlationId, logger) => {

      logger.info({
        event: 'sso_launch_request',
        path: event.path,
        method: event.httpMethod
      })

      const { token } =
        extractLaunchParams(event, correlationId)

      const result =
        await this.launchService.processLaunch(
          token,
          correlationId
        )

      logger.info({
        event: 'sso_launch_success',
        doctorId: result.doctor.id,
        appointmentCount: result.appointments.length
      })

      return mapLaunchResponse(result)

    })

  }
}