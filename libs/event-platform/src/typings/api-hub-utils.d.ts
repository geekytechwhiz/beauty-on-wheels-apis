/** Minimal surface used by `@api-hub/event-platform` from `@api-hub/utils`. */
declare module '@api-hub/utils' {
  export function sha256Hex(data: string | Buffer): string;
  export function stableStringify(value: unknown): string;
}
