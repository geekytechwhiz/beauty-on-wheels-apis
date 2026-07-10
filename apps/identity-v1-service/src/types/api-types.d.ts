/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

export interface Error {
  code?: string;
  message?: string;
  traceId?: string;
}

export interface User {
  id?: string;
  email?: string;
  phone?: string;
  status?: 'PENDING_VERIFICATION' | 'ACTIVE' | 'LOCKED' | 'DISABLED';
  roles?: string[];
}

export interface RegisterRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface VerifyOtpRequest {
  destination: string;
  otp: string;
}

export interface SendOtpRequest {
  destination: string;
}

export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}

