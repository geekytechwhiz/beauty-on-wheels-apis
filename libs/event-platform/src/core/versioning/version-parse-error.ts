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

export declare class VersionParseError extends Error {
  readonly value: string;
  constructor(message: string, value: string);
}
//# sourceMap