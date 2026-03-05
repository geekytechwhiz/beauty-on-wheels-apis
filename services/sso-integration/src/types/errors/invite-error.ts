import { InviteErrorCode } from "../enums";

export class InviteError extends Error {
    public readonly code: InviteErrorCode;
    public readonly statusCode: number;
    public override readonly cause?: Error;
  
    constructor(
      code: InviteErrorCode,
      message: string,
      statusCode = 500,
      cause?: Error
    ) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
      this.cause = cause;
      this.name = 'InviteError';
      Error.captureStackTrace(this, this.constructor);
    }
  
    static invalidRequest(message: string): InviteError {
      return new InviteError(InviteErrorCode.INVALID_REQUEST, message, 400);
    }
  
    static notFound(message = 'Resource not found'): InviteError {
      return new InviteError(InviteErrorCode.NOT_FOUND, message, 404);
    }
  
    static rateLimitExceeded(message = 'Rate limit exceeded'): InviteError {
      return new InviteError(InviteErrorCode.RATE_LIMIT_EXCEEDED, message, 429);
    }
  
    static internalError(message: string, cause?: Error): InviteError {
      return new InviteError(InviteErrorCode.INTERNAL_ERROR, message, 500, cause);
    }
  
    static unauthorized(message = 'Unauthorized'): InviteError {
      return new InviteError(InviteErrorCode.UNAUTHORIZED, message, 401);
    }
  
    static forbidden(message = 'Access denied'): InviteError {
      return new InviteError(InviteErrorCode.FORBIDDEN, message, 403);
    }
  }
  