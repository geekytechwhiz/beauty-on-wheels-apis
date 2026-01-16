export interface OrganizationFile {
  pk: string;
  sk: string;
  organizationId: string;
  fileId: string;
  fileName: string;
  s3Key: string;
  uploadedAt: string;
  itemType: 'ORG_FILE';
  fileSize?: number;
  contentType?: string;
  uploadedBy?: string;
  description?: string;
  tags?: string[];
}
