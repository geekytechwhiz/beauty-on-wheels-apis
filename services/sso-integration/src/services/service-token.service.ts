import * as jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'

import {
  createLogger,
  createChildLogger,
  serializeError
} from '@api-hub/logger'

import {
  ServiceTokenContext,
  ServiceTokenResult
} from '../types/launch.types'
import { ServiceTokenPayload } from '../types/servicesToken.type'
import { CognitoService } from './cognito.service'

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true
})


export class ServiceTokenService {

  private readonly cognitoService: CognitoService;
  private readonly logger = createChildLogger(baseLogger, {
    component: 'ServiceTokenService'
  })

  private readonly secret: string
  private readonly issuer: string
  private readonly audience: string

  constructor() {

    this.secret = process.env.SERVICE_TOKEN_SECRET || ''
    this.issuer = process.env.SERVICE_TOKEN_ISSUER || "firminiq-integration"
    this.audience = process.env.SERVICE_TOKEN_AUDIENCE || "myvitalrx-api"
    this.cognitoService = new CognitoService();
    if (!this.secret) {

      this.logger.warn({
        event: "service_token_secret_missing"
      })

    }

  }

  async generateToken(
    tenantId: string,
    context: ServiceTokenContext,
    correlationId?: string
  ): Promise<ServiceTokenResult> {

    const logger = createChildLogger(this.logger, {
      correlationId,
      tenantId,
      userId: context.userId
    })

    // The doctor may have a personal Cognito password that differs from the SSO
    // common password. Force-set the SSO password (Permanent=true) before every
    // SSO authentication so InitiateAuth always succeeds with a known credential.
    const ssoPassword = process.env.COGNITO_SSO_COMMON_PASSWORD || 'common@2026';
    await this.cognitoService.setPassword(context.userId, ssoPassword);

    const token = await this.cognitoService.generateToken(context.userId, context.role);
    // if (!this.secret) {

    //   const error = new Error("SERVICE_TOKEN_SECRET missing")

    //   logger.error({
    //     event: "service_token_generate_failed",
    //     err: serializeError(error)
    //   })

    //   throw error

    // }

    // const now = Math.floor(Date.now() / 1000)

    // const payload: ServiceTokenPayload = {

    //   iss: this.issuer,

    //   aud: this.audience,

    //   sub: "integration-hms",

    //   tokenType: "SERVICE",

    //   tenantId,

    //   context,

    //   jti: randomUUID(),

    //   iat: now,

    //   exp: now + 3600

    // }

    // const token = jwt.sign(
    //   payload,
    //   this.secret,
    //   { algorithm: "HS256" }
    // )

    // logger.info({
    //   event: "service_token_generated",
    //   role: context.role
    // })

    return {
      accessToken: token.updateToken || '',
      updateToken: token.accessToken || '',
      refreshToken: token.refreshToken || '',
      expiresIn: token.expiresIn || 0,
      userId: context.userId,
      role: context.role
    }

  }

  verifyToken(token: string): ServiceTokenPayload {

    if (!this.secret) {

      throw new Error("SERVICE_TOKEN_SECRET missing")

    }

    return jwt.verify(
      token,
      this.secret,
      {
        algorithms: ["HS256"],
        issuer: this.issuer,
        audience: this.audience
      }
    ) as ServiceTokenPayload

  }

}

let instance: ServiceTokenService | null = null

export function getServiceTokenService() {

  if (!instance) {

    instance = new ServiceTokenService()

  }

  return instance

}