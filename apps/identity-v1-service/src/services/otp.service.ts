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
import { Otp, User, UserAlreadyExistsException, UserType } from "../types/repository.types";
import { SendOtpRequest, VerifyOtpRequest } from "../schemas/otp.schema";
import { env } from "../configs/env.config";
import { AuthenticationService } from "./authentication.service";
import { RegistrationService } from "./registration.service";
import { IdentityKeyBuilder } from '../keys/identity-key.builder';

const baseLogger = createLogger({
    service: "otp-service",
    redactPII: true,
});

const OTP_PURPOSE = 'verification';
const DEVELOPMENT_OTP_VALUE = '123456';

function resolveOtpStage(): string {
  return (env.STAGE || env.NODE_ENV).trim().toLowerCase();
}

function generateOtpCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export class OtpService {
  private readonly logger = createChildLogger(baseLogger, {
    component: 'OtpService',
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

    const normalizedDestination = this.normalizeDestination(destination);
    // The request validator restricts public registration to CUSTOMER/VENDOR.
    // Store the resolved value on the server-side challenge; verification never
    // trusts a role value supplied after the challenge was issued.
    const userType: UserType = body.userType ?? 'CUSTOMER';
    const useFixedOtp = resolveOtpStage() === 'dev' && env.FIXED_OTP_ENABLED;
    this.logger.info({
      event: 'otp_challenge_mode_resolved',
      otpMode: useFixedOtp ? 'FIXED' : 'NORMAL',
    });
    const otpCode = useFixedOtp ? DEVELOPMENT_OTP_VALUE : generateOtpCode();
    const codeHash = crypto.createHash('sha256').update(otpCode).digest('hex');
    const otpId = `o-${crypto.randomUUID()}`;
    const referenceId = crypto.randomBytes(16).toString('hex');

    const otp: Otp = {
      otpId,
      destination: normalizedDestination,
      purpose: OTP_PURPOSE,
      referenceId,
      codeHash,
      attempts: 0,
      verified: false,
      userType,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      ttl: Math.floor((Date.now() + 5 * 60 * 1000) / 1000),
    };

    await this.repository.createOtp(otp);

    this.logger.info({
      event: 'otp_challenge_created',
      referenceId,
      destinationType: this.isEmailDestination(normalizedDestination) ? 'email' : 'phone',
      otpMode: useFixedOtp ? 'FIXED' : 'NORMAL',
    });

    // Fixed challenges intentionally do not invoke SMS delivery. Normal OTP
    // delivery remains handled by the notification integration (and neither
    // path logs or returns the OTP value).

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

    const normalizedDestination = this.normalizeDestination(destination);
    const challenge = await this.repository.getLatestOtp(normalizedDestination, OTP_PURPOSE);

    const useFixedOtp = resolveOtpStage() === 'dev' && env.FIXED_OTP_ENABLED;
    const challengeExpired = Boolean(
      challenge && new Date(challenge.expiresAt).getTime() <= Date.now(),
    );
    const challengeConsumed = Boolean(challenge?.verified);

    this.logger.info({
      event: 'otp_verification',
      otpMode: useFixedOtp ? 'FIXED' : 'NORMAL',
      challengeFound: Boolean(challenge),
      challengeExpired,
      challengeConsumed,
    });

    const codeHash = crypto.createHash('sha256').update(otp).digest('hex');
    const isVerified = await this.repository.verifyOtp(
      normalizedDestination,
      OTP_PURPOSE,
      codeHash,
    );

    if (!isVerified) {
      this.logger.info({
        event: 'otp_verification',
        otpMode: useFixedOtp ? 'FIXED' : 'NORMAL',
        challengeFound: Boolean(challenge),
        verificationResult: 'REJECTED',
      });
      throw new BaseError('Invalid or expired OTP', 400, 'INVALID_OTP');
    }

    this.logger.info({
      event: 'otp_verification',
      otpMode: useFixedOtp ? 'FIXED' : 'NORMAL',
      challengeFound: true,
      verificationResult: 'SUCCESS',
    });

    const cognitoIdentity = await this.cognito.findOrCreateUser(
      this.isEmailDestination(normalizedDestination)
        ? { email: normalizedDestination }
        : {
            phoneNumber: normalizedDestination,
            ...(useFixedOtp ? { markDestinationVerified: false } : {}),
          },
    );

    let user: User;
    try {
      user = await this.resolveApplicationUser(
        normalizedDestination,
        cognitoIdentity.sub,
        cognitoIdentity.username,
        useFixedOtp,
        challenge?.userType ?? 'CUSTOMER',
      );
    } catch (err) {
      this.logger.warn({
        event: 'identity_persistence_failed',
        error: err instanceof Error ? err.name : 'unknown',
      });
      throw err;
    }

    this.logger.info({
      event: 'identity_otp_verification_completed',
      userId: user.userId,
    });
    return this.authenticationService.authenticateExistingIdentity(
      user,
      request,
    );
  }

  private isEmailDestination(destination: string): boolean {
    return destination.includes('@');
  }

  private normalizeDestination(destination: string): string {
    return IdentityKeyBuilder.normalizeDestination(destination);
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
    useFixedOtp: boolean,
    userType: UserType,
  ): Promise<User> {
    const byIdentity = await this.repository.getUserByIdentityId(identityId);
    if (byIdentity) {
      this.logger.info({
        event: 'identity_record_resolved',
        resolution: 'cognito_identity',
      });
      return this.markDestinationVerified(byIdentity, destination, useFixedOtp);
    }

    const existingUser = await this.findIdentityByDestination(destination);
    if (existingUser) {
      const verified = await this.markDestinationVerified(existingUser, destination, useFixedOtp);
      const linked = await this.authenticationService.ensureCognitoLink(verified, {
        sub: identityId,
        username: cognitoUsername,
      });
      this.logger.info({
        event: 'identity_record_resolved',
        resolution: 'destination',
      });
      return linked;
    }

    const created = await this.createIdentityFromVerifiedDestination(
      destination,
      identityId,
      cognitoUsername,
      useFixedOtp,
      userType,
    );
    this.logger.info({ event: 'identity_record_created' });
    return created;
  }

  private async markDestinationVerified(
    user: User,
    destination: string,
    useFixedOtp: boolean,
  ): Promise<User> {
    // A fixed development OTP authenticates the test flow only; it is never
    // evidence that the developer controls the telephone number.
    if (useFixedOtp) {
      return user;
    }
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
      // The OTP has been verified, but do not issue a Cognito token until the
      // application record reflects that verified state. Returning `updated`
      // here used to let authentication continue after a DynamoDB write
      // failure, making the persistence failure indistinguishable from a
      // successful login.
      throw err;
    }
  }

  private async createIdentityFromVerifiedDestination(
    destination: string,
    identityId: string,
    cognitoUsername: string,
    useFixedOtp: boolean,
    userType: UserType,
  ): Promise<User> {
    const isEmail = this.isEmailDestination(destination);

    try {
      return await this.registrationService.createIdentity({
        email: isEmail ? destination : undefined,
        phoneNumber: isEmail ? undefined : destination,
        emailVerified: isEmail,
        phoneVerified: useFixedOtp ? false : !isEmail,
        identityId,
        cognitoUsername,
        userType,
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
