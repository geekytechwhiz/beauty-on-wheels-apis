import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from 'vitest';
import { UserAlreadyExistsError, UserNotFoundError } from '../utils/errors';
import { createMockUser } from '../handlers/__tests__/test-helpers';
import type { UserService } from './user.service';
import type { UserRepository } from '../repositories/user.repository';
import type { OrganizationRepository } from '../repositories/organization.repository';

vi.mock('../repositories/user.repository');
vi.mock('./organization.service', () => ({ getOrganization: vi.fn().mockResolvedValue({ name: 'Acme Hospital', info: 'Acme Info' }) }));
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

const mockRepo: Partial<UserRepository> = {
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

let service: UserService;

beforeAll(async () => {
  const mod = await import('../repositories/user.repository');
  const moduleMod = mod as unknown as { UserRepository: new () => Partial<UserRepository> };
  // Replace exported class with a fake constructor that returns our mockRepo
  moduleMod.UserRepository = class {
    constructor() {
      return mockRepo;
    }
  };

  const svcMod = await import('./user.service');
  const svcCtor = (svcMod as unknown as { UserService: new () => UserService }).UserService;
  service = new svcCtor();
});

describe('UserService', () => {
  const repository = () => (service as unknown as { repository: Partial<UserRepository> }).repository;
  const orgRepository = () => (service as unknown as { organizationRepository: Partial<OrganizationRepository> }).organizationRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Default organization API behavior (organization.service getOrganization)
    const orgServiceMod = await import('./organization.service');
    (orgServiceMod.getOrganization as Mock).mockResolvedValue({ name: 'Acme Hospital', info: 'Acme Info' });
  });

  describe('createUser', () => {
    it('should create user successfully and return user object', async () => {
      const mockUser = createMockUser();
      repository().getUser = vi.fn().mockResolvedValue(null); // User doesn't exist
      repository().createUser = vi.fn().mockResolvedValue(undefined);

      const result = await service.createUser(
        {
          userID: mockUser.userId,
          emailAddress: mockUser.email,
          firstName: mockUser.firstName,
        },
        'test-correlation-id'
      );

      expect(repository().getUser).toHaveBeenCalledWith(mockUser.userId);
      expect(repository().createUser).toHaveBeenCalled();
      expect(result).toMatchObject({
        userID: mockUser.userId,
        emailAddress: mockUser.email,
        firstName: mockUser.firstName,
      });
    });

    it('should throw UserAlreadyExistsError if user already exists', async () => {
      const mockUser = createMockUser();
      repository().getUser = vi.fn().mockResolvedValue(mockUser); // User exists

      await expect(
        service.createUser(
          {
            userID: mockUser.userId,
            emailAddress: mockUser.email,
            firstName: mockUser.firstName,
          },
          'test-correlation-id'
        )
      ).rejects.toThrow(UserAlreadyExistsError);

      expect(repository().createUser).not.toHaveBeenCalled();
    });

    it('should generate MRN for USER when missing', async () => {
      repository().getUser = vi.fn().mockResolvedValue(null);
      repository().createUser = vi.fn().mockResolvedValue(undefined);

      const result = await service.createUser(
        {
          userID: 'user-123',
          userType: 'USER',
          emailAddress: 'patient@example.com',
        },
        'org-1'
      );

      expect(repository().createUser).toHaveBeenCalled();
      expect(result.mrn).toBeDefined();
      expect(String(result.mrn)).toMatch(/^PI-/);
    });

    it('should throw when USER missing email and phone', async () => {
      repository().getUser = vi.fn().mockResolvedValue(null);

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
      repository().getUser = vi.fn().mockResolvedValue(null);

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
      repository().getUser = vi.fn().mockResolvedValue(null);
      repository().createUser = vi.fn().mockResolvedValue(undefined);
      repository().assignUserToOrganization = vi.fn().mockResolvedValue(undefined);
      (await import('./organization.service')).getOrganization.mockResolvedValue({ name: 'Acme Hospital', info: 'Acme Info' });

      const notifyMod = await import('./notification.service');
      const notify = notifyMod.notifyUser as Mock;
      notify.mockClear();

      await service.createUser(
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

      expect(notify.mock.calls.length).toBeGreaterThan(0);
      const callArg = notify.mock.calls[0][0];
      expect(callArg.phone).toBe('+919123456789');
      expect(callArg.deviceToken).toBeUndefined();
      expect(callArg.channels).toEqual(expect.arrayContaining(['email','sms']));
      expect(callArg.templateData.ORG_NAME).toBe('Acme Hospital');
      expect(callArg.templateData.ORG_INFO).toBe('Acme Info');
    });

    it('should call notifyUser with STAFF template and STAFF-specific keys', async () => {
      process.env.PORTAL_LINK = 'https://portal.test';
      repository().getUser = vi.fn().mockResolvedValue(null);
      repository().createUser = vi.fn().mockResolvedValue(undefined);
      repository().assignUserToOrganization = vi.fn().mockResolvedValue(undefined);
      (await import('./organization.service')).getOrganization.mockResolvedValue({ name: 'Acme Hospital', contactInfo: 'Contact Info', organizationAddress: '123 Main St' });

      const notifyMod = await import('./notification.service');
      const notify = notifyMod.notifyUser as Mock;
      notify.mockClear();

      await service.createUser(
        {
          userID: 'staff-1',
          userType: 'STAFF',
          emailAddress: 'staff@example.com',
          firstName: 'Alice',
        },
        'org-1'
      );

      expect(notify.mock.calls.length).toBeGreaterThan(0);
      const callArg = notify.mock.calls[0][0];
      expect(callArg.template).toBe('WELCOME_STAFF');
      expect(callArg.templateData.STAFF_FIRST_NAME).toBe('Alice');
      expect(callArg.templateData.PORTAL_LINK).toBe('https://portal.test');
      expect(callArg.templateData.ORG_ADDRESS).toBe('123 Main St');

      delete process.env.PORTAL_LINK;
    });

    it('should call notifyUser with FNF template-data keys (WEB_DNS_URL, HOSPITAL_ID, FNF_FIRST_NAME)', async () => {
      process.env.WEB_URL = 'https://app.test';
      repository().getUser = vi.fn().mockResolvedValue(null);
      repository().createUser = vi.fn().mockResolvedValue(undefined);
      repository().assignUserToOrganization = vi.fn().mockResolvedValue(undefined);
      (await import('./organization.service')).getOrganization.mockResolvedValue({ name: 'Acme Hospital', contactInfo: 'Contact Info', organizationAddress: '123 Main St', organizationID: 'org-1' });

      const notifyMod = await import('./notification.service');
      const notify = notifyMod.notifyUser as Mock;
      notify.mockClear();

      await service.createUser(
        {
          userID: 'fnf-1',
          userType: 'FNF',
          emailAddress: 'fnf@example.com',
          firstName: 'Bob',
          fullName: 'Bob Friend',
        },
        'org-1'
      );

      expect(notify.mock.calls.length).toBeGreaterThan(0);
      const callArg = notify.mock.calls[0][0];
      expect(callArg.template).toBe('WELCOME_USER');
      expect(callArg.templateData.FNF_FIRST_NAME).toBe('Bob');
      expect(callArg.templateData.WEB_DNS_URL).toBe('https://app.test');
      expect(callArg.templateData.HOSPITAL_ID).toBe('org-1');
      expect(callArg.templateData.USER_NAME).toBe('Bob Friend');

      delete process.env.WEB_URL;
    });
  });

  describe('getUser', () => {
    it('should return user when found', async () => {
      const mockUser = createMockUser();
      repository().getUser = vi.fn().mockResolvedValue(mockUser);

      const result = await service.getUser(mockUser.userId);

      expect(repository().getUser).toHaveBeenCalledWith(mockUser.userId);
      expect(result).toEqual(mockUser);
    });

    it('should throw UserNotFoundError when user not found', async () => {
      repository().getUser = vi.fn().mockResolvedValue(null);

      await expect(service.getUser('non-existent-id')).rejects.toThrow(UserNotFoundError);
    });
  });

  describe('updateUser', () => {
    it('should update user successfully', async () => {
      const mockUser = createMockUser();
      const updatedUser = { ...mockUser, fullName: 'Updated Name' };
      repository().getUser = vi
        .fn()
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(updatedUser);
      repository().updateUser = vi.fn().mockResolvedValue(undefined);

      const result = await service.updateUser(mockUser.userId, { name: 'Updated Name' }, 'test-correlation-id');

      expect(repository().updateUser).toHaveBeenCalledWith(mockUser.userId, { name: 'Updated Name' });
      expect(result.fullName).toBe('Updated Name');
    });

    it('should throw UserNotFoundError when user not found', async () => {
      repository().getUser = vi.fn().mockResolvedValue(null);

      await expect(
        service.updateUser('non-existent-id', { name: 'New Name' }, 'test-correlation-id')
      ).rejects.toThrow(UserNotFoundError);
    });
  });

  describe('deleteUser', () => {
    it('should delete user successfully', async () => {
      const mockUser = createMockUser();
      repository().getUser = vi.fn().mockResolvedValue(mockUser);
      repository().deleteUser = vi.fn().mockResolvedValue(undefined);

      await service.deleteUser(mockUser.userId, 'test-correlation-id');

      expect(repository().getUser).toHaveBeenCalledWith(mockUser.userId);
      expect(repository().deleteUser).toHaveBeenCalledWith(mockUser.userId);
    });

    it('should throw UserNotFoundError when user not found', async () => {
      repository().getUser = vi.fn().mockResolvedValue(null);

      await expect(service.deleteUser('non-existent-id', 'test-correlation-id')).rejects.toThrow(
        UserNotFoundError
      );
    });
  });
});
