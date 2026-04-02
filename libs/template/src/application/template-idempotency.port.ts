export interface TemplateIdempotencyStore {
  getResult<T>(idempotencyKey: string): Promise<T | null>;
  saveResult<T>(idempotencyKey: string, result: T): Promise<void>;
}
