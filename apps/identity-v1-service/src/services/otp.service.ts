import { LambdaRequest, BaseError } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";
import crypto from 'crypto';
import type { CognitoAuthClient } from '@api-hub/authentication-core';
import { getCognitoAuthClient } from '@api-hub/authentication-core';

import {
    IdentityRepository,
    identityRepositoryInstance
} from "../repositories/identity.repository";
import { Otp, User, UserAlreadyExistsException } from "../types/repository.types";
import { SendOtpRequest, VerifyOtpRequest } from "../schemas/otp.schema";
import { env } from "../configs/env.config";
import { AuthenticationService } from "./authentication.service";
import { RegistrationService } from "./registration.service";

const baseLogger = createLogger({
    service: "otp-service",
    redactPII: true,
});

const OTP_PURPOSE = 'verification';
const FIXED_DEV_OTP_STAGES = new Set(['dev', 'development', 'test']);
const NEVER_FIXED_OTP_STAGES = new Set(['staging', 'stage', 'prod', 'production']);

function resolveOtpStage(): string {
  return (env.STAGE || env.NODE_ENV).trim().toLowerCase();
}

function shouldUseFixedDevOtp(): boolean {
  const stage = resolveOtpStage();
  if (NEVER_FIXED_OTP_STAGES.has(stage)) {
    return false;
  }
  return FIXED_DEV_OTP_STAGES.has(stage);
}

function generateOtpCode(): string {
  if (shouldUseFixedDevOtp()) {
    return env.OTP_DEV_CODE;
  }
  return crypto.randomInt(100000, 1000000).toString();
}

export class OtpService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'OtpService',
  });

  private readonly authenticationService: AuthenticationService;
  private readonly registrationService: RegistrationService;

  constructor(
    private readonly repository: IdentityRepository = identityRepositoryInstance,
    authenticationService?: AuthenticationService,
    registrationService?: RegistrationService,
    private readonly cognito: CognitoAuthClient = getCognitoAuthClient(),
  ) {
    this.authenticationService =
      authenticationService ?? new AuthenticationService(repository, this.cognito);
    this.registrationService =
      registrationService ?? new RegistrationService(repository);
  }

  async postsend(request: LambdaRequest) {
    this.logger.info({
      event: 'postsend',
    });

    const body = request.body as SendOtpRequest;
    const destination = body?.destination?.trim();
    if (!destination) {
      throw new BaseError(
        'Destination is required',
        400,
        'DESTINATION_REQUIRED',
      );
    }

    const otpCode = generateOtpCode();
    const codeHash = crypto.createHash('sha256').update(otpCode).digest('hex');
    const otpId = `o-${crypto.randomUUID()}`;
    const referenceId = crypto.randomBytes(16).toString('hex');

    const otp: Otp = {
      otpId,
      destination,
      purpose: OTP_PURPOSE,
      referenceId,
      codeHash,
      attempts: 0,
      verified: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      ttl: Math.floor((Date.now() + 5 * 60 * 1000) / 1000),
    };

    await this.repository.createOtp(otp);

    this.logger.info({
      event: 'OTP Sent',
      referenceId,
      destinationType: this.isEmailDestination(destination) ? 'email' : 'phone',
    });

    // TODO: Notification Service Integration — never log the OTP value.

    return {
      success: true,
      referenceId,
    };
  }

  async postverify(request: LambdaRequest) {
    this.logger.info({
      event: 'postverify',
    });

    const body = request.body as VerifyOtpRequest;

    const destination = body.destination?.trim();
    if (!destination) {
      throw new BaseError(
        'Destination is required',
        400,
        'DESTINATION_REQUIRED',
      );
    }

    const otp = body.otp?.trim();
    if (!otp) {
      throw new BaseError('OTP is required', 400, 'OTP_REQUIRED');
    }

    const codeHash = crypto.createHash('sha256').update(otp).digest('hex');
    const isVerified = await this.repository.verifyOtp(
      destination,
      OTP_PURPOSE,
      codeHash,
    );

    if (!isVerified) {
      throw new BaseError('Invalid or expired OTP', 400, 'INVALID_OTP');
    }

    const cognitoIdentity = await this.cognito.findOrCreateUser(
      this.isEmailDestination(destination)
        ? { email: destination }
        : { phoneNumber: destination },
    );

    const user = await this.resolveApplicationUser(
      destination,
      cognitoIdentity.sub,
      cognitoIdentity.username,
    );

    this.logger.info({ event: 'OTP Verified', userId: user.userId });
    return this.authenticationService.authenticateExistingIdentity(
      user,
      request,
    );
  }

  private isEmailDestination(destination: string): boolean {
    return destination.includes('@');
  }

  private async findIdentityByDestination(destination: string): Promise<User | null> {
    return this.isEmailDestination(destination)
      ? this.repository.getUserByEmail(destination)
      : this.repository.getUserByPhone(destination);
  }

  private async resolveApplicationUser(
    destination: string,
    identityId: string,
    cognitoUsername: string,
  ): Promise<User> {
    const byIdentity = await this.repository.getUserByIdentityId(identityId);
    if (byIdentity) {
      return this.markDestinationVerified(byIdentity, destination);
    }

    const existingUser = await this.findIdentityByDestination(destination);
    if (existingUser) {
      const verified = await this.markDestinationVerified(existingUser, destination);
      return this.authenticationService.ensureCognitoLink(verified, {
        sub: identityId,
        username: cognitoUsername,
      });
    }

    return this.createIdentityFromVerifiedDestination(
      destination,
      identityId,
      cognitoUsername,
    );
  }

  private async markDestinationVerified(
    user: User,
    destination: string,
  ): Promise<User> {
    const isEmail = this.isEmailDestination(destination);
    const alreadyVerified = isEmail ? user.emailVerified : user.phoneVerified;
    if (alreadyVerified) {
      return user;
    }

    const updated: User = {
      ...user,
      emailVerified: isEmail ? true : user.emailVerified,
      phoneVerified: isEmail ? user.phoneVerified : true,
    };

    try {
      return await this.repository.updateUser(updated, user.version);
    } catch (err) {
      this.logger.warn({
        event: 'OTP Verification Flag Update Failed',
        userId: user.userId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      return updated;
    }
  }

  private async createIdentityFromVerifiedDestination(
    destination: string,
    identityId: string,
    cognitoUsername: string,
  ): Promise<User> {
    const isEmail = this.isEmailDestination(destination);

    try {
      return await this.registrationService.createIdentity({
        email: isEmail ? destination : undefined,
        phoneNumber: isEmail ? undefined : destination,
        emailVerified: isEmail,
        phoneVerified: !isEmail,
        identityId,
        cognitoUsername,
      });
    } catch (err) {
      if (err instanceof UserAlreadyExistsException) {
        const raced =
          (await this.repository.getUserByIdentityId(identityId)) ||
          (await this.findIdentityByDestination(destination));
        if (raced) {
          return raced;
        }
      }
      throw err;
    }
  }
}

let service: OtpService;

export function getOtpService() {
    if (!service) {
        service = new OtpService();
    }
    return service;
}
