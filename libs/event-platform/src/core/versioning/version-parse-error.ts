import { VersionCompatibilityStrategy } from "../../typings/consumer.types";

export class VersionIncompatibleError extends Error {
  constructor(
    message: string,
    readonly eventVersion: string,
    readonly supportedVersion: string,
    readonly strategy: VersionCompatibilityStrategy,
  ) {
    super(message);
    this.name = 'VersionIncompatibleError';
  }
}

export class VersionParseError extends Error {
  constructor(
    message: string,
    readonly value: string,
  ) {
    super(message);
    this.name = "VersionParseError";
  }
}