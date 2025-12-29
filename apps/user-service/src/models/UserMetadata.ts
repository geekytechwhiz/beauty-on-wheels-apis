export interface UserMetadata {
  userId: string;
  metadata: Record<string, unknown>;
  updatedAt?: string; // legacy support
  modifiedDate?: string; // current field
}

