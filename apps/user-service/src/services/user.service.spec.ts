import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { UserAlreadyExistsError, UserNotFoundError } from '../utils/errors';
import { createMockUser } from '../handlers/__tests__/test-helpers';

vi.mock('../repositories/user.repository');
vi.mock('../events/event.publisher');
vi.mock('./notification.service', () => ({ notifyUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@api-hub/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
  createPerformanceTimer: vi.fn(() => ({
    end: vi.fn(),
    getDuration: vi.fn(() => 100),
  })),
  serializeError: vi.fn((err) => ({ message: err.message, stack: err.stack })),
}));

const mockRepo: any = {
  getUser: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  assignUserToOrganization: vi.fn(),
  listUserOrganizations: vi.fn(),
  updateUserMetadata: vi.fn(),
  getUserMetadata: vi.fn(),
  createUserFile: vi.fn(),
  listUserFiles: vi.fn(),
};

let service: any;
let UserRepositoryRef: any;

beforeAll(async () => {
  const mod = await import('../repositories/user.repository');
  // Replace exported class with a fake constructor that returns our mockRepo
  (mod as any).UserRepository = class {
    constructor() {
      return mockRepo;
    }
  };

  const svcMod = await import('./user.service');
  service = new (svcMod as any).UserService();
});

describe('UserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default organizationRepository behavior for tests
    (service as any).organizationRepository.getOrganization = vi.fn().mockResolvedValue({ name: 'Acme Hospital', info: 'Acme Info' });
  });

  describe('createUser', () => {
    it('should create user successfully and return user object', async () => {
      const mockUser = createMockUser();
      (service as any).repository.getUser = vi.fn().mockResolvedValue(null); // User doesn't exist
      (service as any).repository.createUser = vi.fn().mockResolvedValue(undefined);

      const result = await service.createUser(
        {
          userID: mockUser.userId,
          email: mockUser.email,
          name: mockUser.name,
        },
        'test-correlation-id'
      );

      expect((service as any).repository.getUser).toHaveBeenCalledWith(mockUser.userId);
      expect((service as any).repository.createUser).toHaveBeenCalled();
      expect(result).toMatchObject({
        userID: mockUser.userId,
        email: mockUser.email,
        name: mockUser.name,
      });
    });

    it('should throw UserAlreadyExistsError if user already exists', async () => {
      const mockUser = createMockUser();
      (service as any).repository.getUser = vi.fn().mockResolvedValue(mockUser); // User exists

      await expect(
        service.createUser(
          {
            userID: mockUser.userId,
            email: mockUser.email,
            name: mockUser.name,
          },
          'test-correlation-id'
        )
      ).rejects.toThrow(UserAlreadyExistsError);

      expect((service as any).repository.createUser).not.toHaveBeenCalled();
    });

    it('should generate MRN for USER when missing', async () => {
      (service as any).repository.getUser = vi.fn().mockResolvedValue(null);
      (service as any).repository.createUser = vi.fn().mockResolvedValue(undefined);

      const result = await service.createUser(
        {
          userID: 'user-123',
          userType: 'USER',
          emailAddress: 'patient@example.com',
        },
        'org-1'
      );

      expect((service as any).repository.createUser).toHaveBeenCalled();
      expect(result.mrn).toBeDefined();
      expect(String(result.mrn)).toMatch(/^PI-/);
    });

    it('should throw when USER missing email and phone', async () => {
      (service as any).repository.getUser = vi.fn().mockResolvedValue(null);

      await expect(
        service.createUser(
          {
            userID: 'user-345',
            userType: 'USER',
          },
          'org-1'
        )
      ).rejects.toThrow('Either email or phone number is required for USER/FNF');
    });

    it('should throw when STAFF missing email', async () => {
      (service as any).repository.getUser = vi.fn().mockResolvedValue(null);

      await expect(
        service.createUser(
          {
            userID: 'staff-1',
            userType: 'STAFF',
            phoneNumber: '9876543210'
          },
          'org-1'
        )
      ).rejects.toThrow('STAFF must have an email address');
    });

    it('should call notifyUser with normalized phone and device token and org data', async () => {
      (service as any).repository.getUser = vi.fn().mockResolvedValue(null);
      (service as any).repository.createUser = vi.fn().mockResolvedValue(undefined);
      (service as any).repository.assignUserToOrganization = vi.fn().mockResolvedValue(undefined);
      (service as any).organizationRepository.getOrganization = vi.fn().mockResolvedValue({ name: 'Acme Hospital', info: 'Acme Info' });

      const notify = (await import('./notification.service')).notifyUser;
      (notify as any).mockClear?.();

      const result = await service.createUser(
        {
          userID: 'user-nt-1',
          userType: 'USER',
          emailAddress: 'user@example.com',
          phoneCode: '91',
          phoneNumber: '9123456789',
          firstName: 'John',
          mrn: 'MRN-1',
        },
        'org-1',
        undefined,
        'corr-1'
      );

      expect((notify as any).mock.calls.length).toBeGreaterThan(0);
      const callArg = (notify as any).mock.calls[0][0];
      expect(callArg.phone).toBe('+919123456789');
      expect(callArg.deviceToken).toBeUndefined();
      expect(callArg.channels).toEqual(expect.arrayContaining(['email','sms']));
      expect(callArg.templateData.ORG_NAME).toBe('Acme Hospital');
      expect(callArg.templateData.ORG_INFO).toBe('Acme Info');
    });
  });

  describe('getUser', () => {
    it('should return user when found', async () => {
      const mockUser = createMockUser();
      (service as any).repository.getUser = vi.fn().mockResolvedValue(mockUser);

      const result = await service.getUser(mockUser.userId);

      expect((service as any).repository.getUser).toHaveBeenCalledWith(mockUser.userId);
      expect(result).toEqual(mockUser);
    });

    it('should throw UserNotFoundError when user not found', async () => {
      (service as any).repository.getUser = vi.fn().mockResolvedValue(null);

      await expect(service.getUser('non-existent-id')).rejects.toThrow(UserNotFoundError);
    });
  });

  describe('updateUser', () => {
    it('should update user successfully', async () => {
      const mockUser = createMockUser();
      const updatedUser = { ...mockUser, name: 'Updated Name' };
      (service as any).repository.getUser = vi
        .fn()
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(updatedUser);
      (service as any).repository.updateUser = vi.fn().mockResolvedValue(undefined);

      const result = await service.updateUser(mockUser.userId, { name: 'Updated Name' }, 'test-correlation-id');

      expect((service as any).repository.updateUser).toHaveBeenCalledWith(mockUser.userId, { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
    });

    it('should throw UserNotFoundError when user not found', async () => {
      (service as any).repository.getUser = vi.fn().mockResolvedValue(null);

      await expect(
        service.updateUser('non-existent-id', { name: 'New Name' }, 'test-correlation-id')
      ).rejects.toThrow(UserNotFoundError);
    });
  });

  describe('deleteUser', () => {
    it('should delete user successfully', async () => {
      const mockUser = createMockUser();
      (service as any).repository.getUser = vi.fn().mockResolvedValue(mockUser);
      (service as any).repository.deleteUser = vi.fn().mockResolvedValue(undefined);

      await service.deleteUser(mockUser.userId, 'test-correlation-id');

      expect((service as any).repository.getUser).toHaveBeenCalledWith(mockUser.userId);
      expect((service as any).repository.deleteUser).toHaveBeenCalledWith(mockUser.userId);
    });

    it('should throw UserNotFoundError when user not found', async () => {
      (service as any).repository.getUser = vi.fn().mockResolvedValue(null);

      await expect(service.deleteUser('non-existent-id', 'test-correlation-id')).rejects.toThrow(
        UserNotFoundError
      );
    });
  });
});
