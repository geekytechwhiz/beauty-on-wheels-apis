import { IRecipientRepository } from '../../../common/providers/IRecipientRepository.js';
import { IStorageProvider } from '../../../common/providers/IStorageProvider.js';
import { environment } from '../../../common/config/environment.js';
import { RecipientGroup, Recipient } from '../domain/types.js';
import { CreateGroupInput } from '../dto/schemas.js';
import { logger } from '../../../common/utils/logger.js';

export class RecipientService {
  private repository: IRecipientRepository;
  private storage: IStorageProvider;

  constructor(repository: IRecipientRepository, storage: IStorageProvider) {
    this.repository = repository;
    this.storage = storage;
  }

  async listGroups(): Promise<RecipientGroup[]> {
    return this.repository.listGroups();
  }

  async createGroup(input: CreateGroupInput): Promise<{ groupId: string; processedCount: number }> {
    const timestamp = this.getFormattedTimestamp();
    const groupId = `recipients-${input.tableName}-${timestamp}`;
    const dateStr = new Date().toISOString();

    logger.info(
      `Creating manual recipient group ${groupId} with ${input.recipients.length} entries`,
    );

    // Register group in the registry
    await this.repository.registerGroup({
      groupId,
      originalFilename: `${input.tableName}-manual-entry.csv`,
      createdAt: dateStr,
      s3Key: 'manual-entry',
      source: 'manual',
    });

    // Bulk insert recipients
    const recipients: Recipient[] = input.recipients
      .filter(r => r.email && r.email.includes('@'))
      .map(r => ({
        groupId,
        emailAddress: r.email.trim(),
        firstName: r.firstName?.trim(),
        lastName: r.lastName?.trim(),
        topics: Array.isArray(r.topics) ? r.topics : [],
        createdAt: dateStr,
      }));

    await this.repository.addRecipientsBatch(recipients);

    return {
      groupId,
      processedCount: recipients.length,
    };
  }

  async generateUploadUrl(
    originalFilename: string,
  ): Promise<{ uploadUrl: string; filename: string }> {
    let cleanName = originalFilename;
    if (cleanName.endsWith('.csv')) {
      cleanName = cleanName.slice(0, -4);
    }
    // Clean spaces and special characters
    cleanName = cleanName.replace(/[^a-zA-Z0-9_-]/g, '');

    const timestamp = this.getFormattedTimestamp();
    const filename = `${cleanName}-${timestamp}.csv`;

    const uploadUrl = await this.storage.generatePresignedUploadUrl({
      bucket: environment.recipientsBucket,
      key: filename,
      contentType: 'text/csv',
      expiresInSeconds: 300, // 5 minutes
    });

    return {
      uploadUrl,
      filename,
    };
  }

  async processUploadedCsv(
    bucket: string,
    s3Key: string,
  ): Promise<{ processedCount: number; groupId: string }> {
    logger.info(`Processing uploaded CSV s3://${bucket}/${s3Key}`);

    const parts = s3Key.split('/');
    const filename = parts[parts.length - 1] || 'recipients.csv';
    const baseName = filename.replace('.csv', '');
    const groupId = `recipients-${baseName}`;
    const dateStr = new Date().toISOString();

    // Fetch object from S3
    const s3Object = await this.storage.getObject(bucket, s3Key);
    const rows = this.parseCSV(s3Object.body);

    if (rows.length === 0) {
      logger.warn(`CSV file s3://${bucket}/${s3Key} is empty`);
      return { processedCount: 0, groupId };
    }

    let emailIdx = 0;
    let firstNameIdx: number | null = null;
    let lastNameIdx: number | null = null;
    let topicsIdx: number | null = null;
    let startRowIndex = 0;

    // Detect header row
    const firstRow = rows[0];
    if (firstRow) {
      const isHeader = firstRow.some(cell =>
        [
          'email',
          'emailaddress',
          'first_name',
          'firstname',
          'fname',
          'last_name',
          'lastname',
          'lname',
          'topics',
          'topic',
        ].includes(cell.toLowerCase().trim()),
      );

      if (isHeader) {
        startRowIndex = 1;
        firstRow.forEach((cell, idx) => {
          const lower = cell.toLowerCase().trim();
          if (lower === 'email' || lower === 'emailaddress') emailIdx = idx;
          else if (['first_name', 'firstname', 'fname'].includes(lower)) firstNameIdx = idx;
          else if (['last_name', 'lastname', 'lname'].includes(lower)) lastNameIdx = idx;
          else if (lower === 'topics' || lower === 'topic') topicsIdx = idx;
        });
      }
    }

    // Register group in registry
    await this.repository.registerGroup({
      groupId,
      originalFilename: filename,
      createdAt: dateStr,
      s3Key,
      source: 'csv',
    });

    // Parse records
    const recipients: Recipient[] = [];
    for (let i = startRowIndex; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const email = row[emailIdx]?.trim();
      if (email && email.includes('@')) {
        const firstName = firstNameIdx !== null ? row[firstNameIdx]?.trim() : undefined;
        const lastName = lastNameIdx !== null ? row[lastNameIdx]?.trim() : undefined;
        const topicsRaw = topicsIdx !== null ? row[topicsIdx]?.trim() : undefined;

        const topics = topicsRaw
          ? topicsRaw
              .split(',')
              .map(t => t.trim())
              .filter(t => t.length > 0)
          : [];

        recipients.push({
          groupId,
          emailAddress: email,
          firstName,
          lastName,
          topics,
          createdAt: dateStr,
        });
      }
    }

    logger.info(`Parsed ${recipients.length} recipients. Writing to database...`);
    await this.repository.addRecipientsBatch(recipients);
    logger.info(`Successfully processed S3 CSV upload into group ${groupId}`);

    return {
      processedCount: recipients.length,
      groupId,
    };
  }

  // --- Helper Methods ---
  private getFormattedTimestamp(): string {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}-${min}`;
  }

  private parseCSV(content: string): string[][] {
    const lines: string[][] = [];
    let row: string[] = [];
    let currentVal = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentVal += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(currentVal.trim());
        currentVal = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++; // Skip LF
        }
        row.push(currentVal.trim());
        if (row.length > 0 && row.some(cell => cell !== '')) {
          lines.push(row);
        }
        row = [];
        currentVal = '';
      } else {
        currentVal += char;
      }
    }

    if (currentVal || row.length > 0) {
      row.push(currentVal.trim());
      if (row.length > 0 && row.some(cell => cell !== '')) {
        lines.push(row);
      }
    }

    return lines;
  }
}
