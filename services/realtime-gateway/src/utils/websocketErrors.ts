export class UnauthorizedConnectionError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedConnectionError';
  }
}

export class InvalidConnectionContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConnectionContextError';
  }
}
