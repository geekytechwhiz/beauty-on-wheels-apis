import { UserService } from './user.service';
import { UserRepository } from '../repositories/user.repository';
import { UserAlreadyExistsError, UserNotFoundError } from '../utils/errors';
import { createMockUser } from '../handlers/__tests__/test-helpers';

jest.mock('../repositories/user.repository');
jest.mock('../events/event.publisher');
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
  createPerformanceTimer: jest.fn(() => ({
    end: jest.fn(),
    getDuration: jest.fn(() => 100),
  })),
  serializeError: jest.fn((err) => ({ message: err.message, stack: err.stack })),
}));

const mockRepo = {
  getUser: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  assignUserToOrganization: jest.fn(),
  listUserOrganizations: jest.fn(),
  updateUserMetadata: jest.fn(),
  getUserMetadata: jest.fn(),
  createUserFile: jest.fn(),
  listUserFiles: jest.fn(),
} as jest.Mocked<UserRepository>;

// Mock the UserRepository constructor to return our mock
jest.spyOn(UserRepository.prototype, 'constructor' as any).mockImplementation(() => mockRepo);

const service = new UserService();

describe('UserService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    it('should create user successfully and return user object', async () => {
      const mockUser = createMockUser();
      (service as any).repository.getUser = jest.fn().mockResolvedValue(null); // User doesn't exist
      (service as any).repository.createUser = jest.fn().mockResolvedValue(undefined);

      const result = await service.createUser(
        {
          userId: mockUser.userId,
          email: mockUser.email,
          name: mockUser.name,
        },
        'test-correlation-id'
      );

      expect((service as any).repository.getUser).toHaveBeenCalledWith(mockUser.userId);
      expect((service as any).repository.createUser).toHaveBeenCalled();
      expect(result).toMatchObject({
        userId: mockUser.userId,
        email: mockUser.email,
        name: mockUser.name,
      });
    });

    it('should throw UserAlreadyExistsError if user already exists', async () => {
      const mockUser = createMockUser();
      (service as any).repository.getUser = jest.fn().mockResolvedValue(mockUser); // User exists

      await expect(
        service.createUser(
          {
            userId: mockUser.userId,
            email: mockUser.email,
            name: mockUser.name,
          },
          'test-correlation-id'
        )
      ).rejects.toThrow(UserAlreadyExistsError);

      expect((service as any).repository.createUser).not.toHaveBeenCalled();
    });
  });

  describe('getUser', () => {
    it('should return user when found', async () => {
      const mockUser = createMockUser();
      (service as any).repository.getUser = jest.fn().mockResolvedValue(mockUser);

      const result = await service.getUser(mockUser.userId);

      expect((service as any).repository.getUser).toHaveBeenCalledWith(mockUser.userId);
      expect(result).toEqual(mockUser);
    });

    it('should throw UserNotFoundError when user not found', async () => {
      (service as any).repository.getUser = jest.fn().mockResolvedValue(null);

      await expect(service.getUser('non-existent-id')).rejects.toThrow(UserNotFoundError);
    });
  });

  describe('updateUser', () => {
    it('should update user successfully', async () => {
      const mockUser = createMockUser();
      const updatedUser = { ...mockUser, name: 'Updated Name' };
      (service as any).repository.getUser = jest
        .fn()
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(updatedUser);
      (service as any).repository.updateUser = jest.fn().mockResolvedValue(undefined);

      const result = await service.updateUser(mockUser.userId, { name: 'Updated Name' }, 'test-correlation-id');

      expect((service as any).repository.updateUser).toHaveBeenCalledWith(mockUser.userId, { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
    });

    it('should throw UserNotFoundError when user not found', async () => {
      (service as any).repository.getUser = jest.fn().mockResolvedValue(null);

      await expect(
        service.updateUser('non-existent-id', { name: 'New Name' }, 'test-correlation-id')
      ).rejects.toThrow(UserNotFoundError);
    });
  });

  describe('deleteUser', () => {
    it('should delete user successfully', async () => {
      const mockUser = createMockUser();
      (service as any).repository.getUser = jest.fn().mockResolvedValue(mockUser);
      (service as any).repository.deleteUser = jest.fn().mockResolvedValue(undefined);

      await service.deleteUser(mockUser.userId, 'test-correlation-id');

      expect((service as any).repository.getUser).toHaveBeenCalledWith(mockUser.userId);
      expect((service as any).repository.deleteUser).toHaveBeenCalledWith(mockUser.userId);
    });

    it('should throw UserNotFoundError when user not found', async () => {
      (service as any).repository.getUser = jest.fn().mockResolvedValue(null);

      await expect(service.deleteUser('non-existent-id', 'test-correlation-id')).rejects.toThrow(
        UserNotFoundError
      );
    });
  });
});
