import { LambdaRequest } from '@api-hub/utils';
import { z } from 'zod';
import { LoginRequestSchema } from './login.validator';
import { LogoutRequestSchema } from './logout.validator';
import { RefreshTokenRequestSchema } from './refresh-token.validator';
import { VerifyOtpRequestSchema } from './verify-otp.validator';

export const RegisterRequestSchema = z.object({
  firstName: z.string().trim().min(2).max(50),

  lastName: z.string().trim().min(2).max(50),

  email: z.string().trim().toLowerCase().email().max(255),

  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,15}$/),

  password: z
    .string()
    .min(8)
    .max(128)
    .regex(/[A-Z]/)
    .regex(/[a-z]/)
    .regex(/[0-9]/)
    .regex(/[!@#$%^&*(),.?":{}|<>]/),

  role: z.enum(['CUSTOMER', 'VENDOR', 'ADMIN']),

  referralCode: z.string().trim().max(30).optional(),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const validateRegisterRequest = (req: LambdaRequest) => {
  return RegisterRequestSchema.parse(req);
};
export const validateLoginRequest = (req: LambdaRequest) => {
  return LoginRequestSchema.parse(req);
};
export const validateLogoutRequest = (req: LambdaRequest) => {
  return LogoutRequestSchema.parse(req);
};
export const validateRefreshTokenRequest = (req: LambdaRequest) => {
  return RefreshTokenRequestSchema.parse(req);
};
export const validateVerifyOtpRequest = (req: LambdaRequest) => {
  return VerifyOtpRequestSchema.parse(req);
};