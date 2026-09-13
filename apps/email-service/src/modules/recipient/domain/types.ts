export interface RecipientGroup {
  groupId: string;
  originalFilename: string;
  createdAt: string;
  s3Key: string;
  source: 'csv' | 'manual';
}

export interface Recipient {
  groupId: string;
  emailAddress: string;
  firstName?: string;
  lastName?: string;
  topics?: string[];
  createdAt: string;
}

export interface ImportRecipient {
  email: string;
  firstName?: string;
  lastName?: string;
  topics?: string[];
}
