import { DomainError } from "./domain-error.ts";

export const throwBadRequest = (message: string, code: string) => {
  throw new DomainError(message, code, 400);
};

export const throwUnauthorized = (message: string, code: string) => {
  throw new DomainError(message, code, 401);
};

export const throwForbidden = (message: string, code: string) => {
  throw new DomainError(message, code, 403);
};

export const throwNotFound = (message: string, code: string) => {
  throw new DomainError(message, code, 404);
};

export const throwConflict = (message: string, code: string) => {
  throw new DomainError(message, code, 409);
};

export const throwValidation = (message: string, code: string) => {
  throw new DomainError(message, code, 422);
};

export const throwInternal = (message: string, code: string) => {
  throw new DomainError(message, code, 500);
};