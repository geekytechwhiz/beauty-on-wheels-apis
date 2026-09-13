import { RecipientService } from '../services/RecipientService.js';
import { IRecipientRepository } from '../../../common/providers/IRecipientRepository.js';
import { IStorageProvider } from '../../../common/providers/IStorageProvider.js';

describe('RecipientService', () => {
  let recipientService: RecipientService;
  let mockRepository: jest.Mocked<IRecipientRepository>;
  let mockStorage: jest.Mocked<IStorageProvider>;

  beforeEach(() => {
    mockRepository = {
      registerGroup: jest.fn(),
      getGroup: jest.fn(),
      listGroups: jest.fn(),
      addRecipient: jest.fn(),
      addRecipientsBatch: jest.fn(),
      listRecipientsInGroup: jest.fn(),
    } as any;

    mockStorage = {
      putObject: jest.fn(),
      getObject: jest.fn(),
      getObjectAsBuffer: jest.fn(),
      generatePresignedUploadUrl: jest.fn(),
    } as any;

    recipientService = new RecipientService(mockRepository, mockStorage);
  });

  describe('listGroups', () => {
    it('should return groups listed in repository', async () => {
      const mockGroups = [
        {
          groupId: 'recipients-test-1',
          originalFilename: 'test-1.csv',
          createdAt: '2026-06-29T20:00:00Z',
          s3Key: 'test-1.csv',
          source: 'csv' as const,
        },
      ];
      mockRepository.listGroups.mockResolvedValue(mockGroups);

      const result = await recipientService.listGroups();
      expect(result).toEqual(mockGroups);
      expect(mockRepository.listGroups).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateUploadUrl', () => {
    it('should generate a formatted key and call storage provider', async () => {
      mockStorage.generatePresignedUploadUrl.mockResolvedValue('https://presigned.s3.url');

      const result = await recipientService.generateUploadUrl('my recipient list.csv');

      expect(result.uploadUrl).toBe('https://presigned.s3.url');
      expect(result.filename).toMatch(/^myrecipientlist-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);
      expect(mockStorage.generatePresignedUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: expect.any(String),
          contentType: 'text/csv',
          expiresInSeconds: 300,
        }),
      );
    });
  });

  describe('createGroup', () => {
    it('should register group and bulk insert valid recipients', async () => {
      const input = {
        tableName: 'manual-test',
        recipients: [
          { email: 'john@example.com', firstName: 'John', lastName: 'Doe', topics: ['topic-1'] },
          { email: 'invalid-email', firstName: 'Bad' },
          { email: 'jane@example.com', firstName: 'Jane' },
        ],
      };

      const result = await recipientService.createGroup(input);

      expect(result.groupId).toMatch(/^recipients-manual-test-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/);
      expect(result.processedCount).toBe(2); // Only valid emails

      expect(mockRepository.registerGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: result.groupId,
          originalFilename: 'manual-test-manual-entry.csv',
          source: 'manual',
        }),
      );

      expect(mockRepository.addRecipientsBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            groupId: result.groupId,
            emailAddress: 'john@example.com',
            firstName: 'John',
            lastName: 'Doe',
            topics: ['topic-1'],
          }),
          expect.objectContaining({
            groupId: result.groupId,
            emailAddress: 'jane@example.com',
            firstName: 'Jane',
            topics: [],
          }),
        ]),
      );
    });
  });

  describe('processUploadedCsv', () => {
    it('should parse headers, detect columns and batch insert CSV rows', async () => {
      const csvBody = `Email,First_Name,Last_Name,Topics
john@example.com,John,Doe,"topic-1,topic-2"
jane@example.com,Jane,Smith,topic-1
empty-row,,
bademail,Bad,Name,
`;
      mockStorage.getObject.mockResolvedValue({ body: csvBody });

      const result = await recipientService.processUploadedCsv('my-bucket', 'uploads/list.csv');

      expect(result.groupId).toBe('recipients-list');
      expect(result.processedCount).toBe(2); // Only valid emails (john, jane)

      expect(mockRepository.registerGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'recipients-list',
          originalFilename: 'list.csv',
          source: 'csv',
        }),
      );

      expect(mockRepository.addRecipientsBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            groupId: 'recipients-list',
            emailAddress: 'john@example.com',
            firstName: 'John',
            lastName: 'Doe',
            topics: ['topic-1', 'topic-2'],
          }),
          expect.objectContaining({
            groupId: 'recipients-list',
            emailAddress: 'jane@example.com',
            firstName: 'Jane',
            lastName: 'Smith',
            topics: ['topic-1'],
          }),
        ]),
      );
    });

    it('should handle CSV files without header rows by using index-0 as email address fallback', async () => {
      const csvBody = `bob@example.com,Bob,Jones
alice@example.com,Alice,Wonder
`;
      mockStorage.getObject.mockResolvedValue({ body: csvBody });

      const result = await recipientService.processUploadedCsv('my-bucket', 'uploads/list.csv');

      expect(result.processedCount).toBe(2);
      expect(mockRepository.addRecipientsBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            emailAddress: 'bob@example.com',
          }),
          expect.objectContaining({
            emailAddress: 'alice@example.com',
          }),
        ]),
      );
    });
  });
});
