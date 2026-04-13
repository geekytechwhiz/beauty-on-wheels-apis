/**
 * Optional TTL for store implementations that support time-bounded keys
 * (for example DynamoDB TTL); ignored by stores that do not implement expiry.
 */
export type IdempotencySaveOptions = {
  ttlSeconds?: number;
};

export interface IdempotencyStore {
  exists(key: string): Promise<boolean>;
  save(key: string, options?: IdempotencySaveOptions): Promise<void>;
}
