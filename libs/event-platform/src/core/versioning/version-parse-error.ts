export class VersionParseError extends Error {
  constructor(
    message: string,
    readonly value: string,
  ) {
    super(message);
    this.name = 'VersionParseError';
  }
}
