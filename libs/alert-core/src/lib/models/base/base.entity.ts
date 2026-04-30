export interface BaseEntity {
  id: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}
