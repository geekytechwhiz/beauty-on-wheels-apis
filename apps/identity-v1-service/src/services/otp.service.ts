import { LambdaRequest, BaseError } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";
import crypto from 'crypto';

import {
    IdentityRepository,
    identityRepositoryInstance
} from "../repositories/identity.repository";
import { Otp } from "../types/repository.types";
import { SendOtpRequest, VerifyOtpRequest } from "../schemas/otp.schema";

const baseLogger = createLogger({
    service: "otp-service",
    redactPII: true,
});

export class OtpService {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "OtpService"
            }
        );

    constructor(
        private readonly repository: IdentityRepository = identityRepositoryInstance
    ) {}

    async postsend(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "postsend",
        });

        const body = request.body as SendOtpRequest;
        const destination = body.destination.trim();

        // Find user by email or phone
        const user = destination.includes('@')
            ? await this.repository.getUserByEmail(destination)
            : await this.repository.getUserByPhone(destination);

        if (!user) {
            this.logger.info({ event: 'OTP Send Failed', reason: 'User not found', destination });
            throw new BaseError("User not found", 404, "USER_NOT_FOUND");
        }

        // Generate 6-digit OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const codeHash = crypto.createHash('sha256').update(otpCode).digest('hex');
        const otpId = `o-${crypto.randomUUID()}`;
        const referenceId = crypto.randomBytes(16).toString('hex');

        const otp: Otp = {
            otpId,
            userId: user.userId,
            purpose: 'verification',
            referenceId,
            codeHash,
            attempts: 0,
            verified: false,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes expiration
            ttl: Math.floor((Date.now() + 5 * 60 * 1000) / 1000),
        };

        await this.repository.createOtp(otp);

        this.logger.info({ event: 'OTP Sent', userId: user.userId, referenceId });

        // TODO: Notification Service Integration
        // notificationService.sendSms(user.phoneNumber, `Your OTP code is ${otpCode}`);
        // or notificationService.sendEmail(user.email, `Your OTP code is ${otpCode}`);

        return {
            success: true,
            referenceId,
        };
    }

    async postverify(
        request: LambdaRequest
    ) {
        this.logger.info({
            event: "postverify",
        });

        const body = request.body as VerifyOtpRequest;
        const destination = body.destination.trim();

        // Find user by email or phone
        const user = destination.includes('@')
            ? await this.repository.getUserByEmail(destination)
            : await this.repository.getUserByPhone(destination);

        if (!user) {
            throw new BaseError("User not found", 404, "USER_NOT_FOUND");
        }

        const codeHash = crypto.createHash('sha256').update(body.otp.trim()).digest('hex');
        const isVerified = await this.repository.verifyOtp(user.userId, 'verification', codeHash);

        if (!isVerified) {
            this.logger.info({ event: 'OTP Verification Failed', userId: user.userId });
            throw new BaseError("Invalid or expired OTP", 400, "INVALID_OTP");
        }

        this.logger.info({ event: 'OTP Verified', userId: user.userId });
    }
}

let service: OtpService;

export function getOtpService() {
    if (!service) {
        service = new OtpService();
    }
    return service;
}
