export interface RecipientGroupRecord {
  groupId: string;
  originalFilename: string;
  createdAt: string;
  s3Key: string;
  source: 'csv' | 'manual';
}

export interface RecipientRecord {
  groupId: string;
  emailAddress: string;
  firstName?: string;
  lastName?: string;
  topics?: string[];
  createdAt: string;
}

export interface IRecipientRepository {
  // Recipient Group Management
  registerGroup(group: RecipientGroupRecord): Promise<void>;
  getGroup(groupId: string): Promise<RecipientGroupRecord | null>;
  listGroups(): Promise<RecipientGroupRecord[]>;

  // Recipient List CRUD
  addRecipient(recipient: RecipientRecord): Promise<void>;
  addRecipientsBatch(recipients: RecipientRecord[]): Promise<void>;
  listRecipientsInGroup(groupId: string): Promise<RecipientRecord[]>;
}
