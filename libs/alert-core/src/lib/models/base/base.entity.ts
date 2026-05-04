export interface BaseEntity {
  id: string;
  organizationId: string;
  /** Unix epoch milliseconds (UTC). */
  createdAt: number;
  /** Unix epoch milliseconds (UTC). */
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
}
