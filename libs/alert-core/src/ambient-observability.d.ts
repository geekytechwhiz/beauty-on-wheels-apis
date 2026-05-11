/** Minimal typing for optional runtime dependency (resolved via peer / app bundle). */
declare module '@api-hub/observability' {
  export function recordUpstreamRetryAttempts(
    dependency: string,
    attempts: number,
  ): void;
}
