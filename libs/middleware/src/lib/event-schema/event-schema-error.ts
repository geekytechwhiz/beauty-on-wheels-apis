import { ZodError } from 'zod';

export class EventSchemaError extends Error {
  constructor(
    message: string,
    readonly zodError: ZodError,
  ) {
    super(message, { cause: zodError });
    this.name = 'EventSchemaError';
  }
}
