import { SSOErrorCode } from "../enums";

export class SSOError extends Error {
    public readonly code: SSOErrorCode;
    public readonly statusCode: number;
    public override readonly cause?: Error;
  
    constructor(
      code: SSOErrorCode,
      message: string,
      statusCode = 500,
      cause?: Error
    ) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
      this.cause = cause;
      this.name = 'SSOError';
      Error.captureStackTrace(this, this.constructor);
    }
  
    static invalidToken(message = 'Invalid or malformed launch token'): SSOError {
      return new SSOError(SSOErrorCode.INVALID_TOKEN, message, 400);
    }
  
    static verificationFailed(message = 'Token verification failed'): SSOError {
      return new SSOError(SSOErrorCode.TOKEN_VERIFICATION_FAILED, message, 401);
    }
  
    static userInactive(message = 'User account is inactive'): SSOError {
      return new SSOError(SSOErrorCode.USER_INACTIVE, message, 403);
    }
  
    static userServiceError(message: string, cause?: Error): SSOError {
      return new SSOError(SSOErrorCode.USER_SERVICE_ERROR, message, 503, cause);
    }
  
    static roleServiceError(message: string, cause?: Error): SSOError {
      return new SSOError(SSOErrorCode.ROLE_SERVICE_ERROR, message, 503, cause);
    }
  
    static cognitoAuthError(message: string, cause?: Error): SSOError {
      return new SSOError(SSOErrorCode.COGNITO_AUTH_ERROR, message, 503, cause);
    }
  
    static downstreamError(message: string, cause?: Error): SSOError {
      return new SSOError(SSOErrorCode.DOWNSTREAM_SERVICE_ERROR, message, 503, cause);
    }
  
    static rateLimitExceeded(message = 'Rate limit exceeded'): SSOError {
      return new SSOError(SSOErrorCode.RATE_LIMIT_EXCEEDED, message, 429);
    }
  
    static internalError(message: string, cause?: Error): SSOError {
      return new SSOError(SSOErrorCode.INTERNAL_ERROR, message, 500, cause);
    }
  
    static unauthorized(message = 'Unauthorized'): SSOError {
      return new SSOError(SSOErrorCode.UNAUTHORIZED, message, 401);
    }
  
    static forbidden(message = 'Access denied'): SSOError {
      return new SSOError(SSOErrorCode.FORBIDDEN, message, 403);
    }
  
    static notFound(message = 'Resource not found'): SSOError {
      return new SSOError(SSOErrorCode.NOT_FOUND, message, 404);
    }
  
    static invalidRequest(message: string): SSOError {
      return new SSOError(SSOErrorCode.INVALID_REQUEST, message, 400);
    }
  
    static truTechServiceError(message: string, cause?: Error): SSOError {
      return new SSOError(SSOErrorCode.TRU_TECH_SERVICE_ERROR, message, 503, cause);
    }
  }