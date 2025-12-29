import { UserRepository } from './user.repository';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UserAlreadyExistsError, UserNotFoundError } from '../utils/errors';
import { createMockUser } from '../handlers/__tests__/test-helpers';

jest.mock('../utils/db.config', () => ({
  docClient: {
    send: jest.fn(),
  },
}));

jest.mock('@api-hub/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  createChildLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  serializeError: jest.fn((err) => ({ message: err.message, stack: err.stack })),
}));

import { docClient } from '../utils/db.config';

const mockSend = (docClient.send as jest.Mock);
const repo = new UserRepository();

describe('UserRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    it('should create user successfully', async () => {
      const mockUser = createMockUser();
      mockSend.mockResolvedValue({});

      await expect(repo.createUser(mockUser)).resolves.toBeUndefined();

      expect(mockSend).toHaveBeenCalled();
      const command = mockSend.mock.calls[0][0];
      expect(command.input.Item.userId).toBe(mockUser.userId);
      expect(command.input.Item.email).toBe(mockUser.email);
      expect(command.input.Item.name).toBe(mockUser.name);
    });

    it('should throw UserAlreadyExistsError when user already exists', async () => {
      const mockUser = createMockUser();
      const error = new ConditionalCheckFailedException({ message: 'Conditional check failed', $metadata: {} });
      mockSend.mockRejectedValue(error);

      await expect(repo.createUser(mockUser)).rejects.toThrow(UserAlreadyExistsError);
    });
  });

  describe('getUser', () => {
    it('should return user when found', async () => {
      const mockUser = createMockUser();
      mockSend.mockResolvedValue({
        Item: {
          userId: mockUser.userId,
          email: mockUser.email,
          name: mockUser.name,
          createdAt: mockUser.createdAt,
          updatedAt: mockUser.updatedAt,
          deleted: false,
        },
      });

      const result = await repo.getUser(mockUser.userId);

      expect(result).toMatchObject({
        userId: mockUser.userId,
        email: mockUser.email,
        name: mockUser.name,
      });
    });

    it('should return null when user not found', async () => {
      mockSend.mockResolvedValue({ Item: undefined });

      const result = await repo.getUser('non-existent-id');

      expect(result).toBeNull();
    });

    it('should return null when user is deleted', async () => {
      mockSend.mockResolvedValue({
        Item: {
          userId: 'test-id',
          email: 'test@example.com',
          name: 'Test',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          deleted: true,
        },
      });

      const result = await repo.getUser('test-id');

      expect(result).toBeNull();
    });
  });

  describe('updateUser', () => {
    it('should update user successfully', async () => {
      mockSend.mockResolvedValue({});

      await expect(repo.updateUser('test-id', { name: 'Updated Name' })).resolves.toBeUndefined();

      expect(mockSend).toHaveBeenCalled();
    });

    it('should throw UserNotFoundError when user not found', async () => {
      const error = new ConditionalCheckFailedException({ message: 'Conditional check failed', $metadata: {} });
      mockSend.mockRejectedValue(error);

      await expect(repo.updateUser('non-existent-id', { name: 'New Name' })).rejects.toThrow(
        UserNotFoundError
      );
    });
  });

  describe('deleteUser', () => {
    it('should delete user successfully', async () => {
      mockSend.mockResolvedValue({});

      await expect(repo.deleteUser('test-id')).resolves.toBeUndefined();

      expect(mockSend).toHaveBeenCalled();
    });

    it('should throw UserNotFoundError when user not found', async () => {
      const error = new ConditionalCheckFailedException({ message: 'Conditional check failed', $metadata: {} });
      mockSend.mockRejectedValue(error);

      await expect(repo.deleteUser('non-existent-id')).rejects.toThrow(UserNotFoundError);
    });
  });
});
