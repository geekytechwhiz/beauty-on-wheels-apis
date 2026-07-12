import { RegistrationService } from './registration.service';
import { AuthenticationService, verifyPassword } from './authentication.service';
import { OtpService } from './otp.service';
import { ProfileService } from './profile.service';
import { SessionsService } from './sessions.service';
import { RolesService } from './roles.service';
import { PermissionsService } from './permissions.service';
import { IdentityRepository } from '../repositories/identity.repository';
import { ProfileRepository } from '../repositories/profile.repository';
import { User, Profile, Session, Otp, Role, Permission, UserAlreadyExistsException, InvalidRefreshTokenException } from '../types/repository.types';
import { LambdaRequest, BaseError } from '@api-hub/utils';
import crypto from 'crypto';

describe('Services Unit Tests', () => {
    let mockRepo: jest.Mocked<IdentityRepository>;
    let mockProfileRepo: jest.Mocked<ProfileRepository>;

    beforeEach(() => {
        mockRepo = {
            getUser: jest.fn(),
            getUserByEmail: jest.fn(),
            getUserByPhone: jest.fn(),
            getUserByUsername: jest.fn(),
            createUser: jest.fn(),
            updateUser: jest.fn(),
            deleteUser: jest.fn(),
            createSession: jest.fn(),
            getSession: jest.fn(),
            listSessions: jest.fn(),
            deleteSession: jest.fn(),
            deleteAllSessions: jest.fn(),
            getRefreshToken: jest.fn(),
            deleteRefreshToken: jest.fn(),
            changePassword: jest.fn(),
            saveLoginHistory: jest.fn(),
            createOtp: jest.fn(),
            verifyOtp: jest.fn(),
            assignRole: jest.fn(),
            removeRole: jest.fn(),
            getUserRoles: jest.fn(),
            listRoles: jest.fn(),
            listPermissions: jest.fn(),
            hasPermission: jest.fn(),
        } as unknown as jest.Mocked<IdentityRepository>;

        mockProfileRepo = {
            ...mockRepo,
            getProfile: jest.fn(),
            updateProfile: jest.fn(),
            deleteProfile: jest.fn(),
        } as unknown as jest.Mocked<ProfileRepository>;
    });

    describe('RegistrationService', () => {
        it('registers user successfully', async () => {
            mockRepo.getUserByEmail.mockResolvedValue(null);
            mockRepo.getUserByUsername.mockResolvedValue(null);
            mockRepo.getUserByPhone.mockResolvedValue(null);
            mockRepo.createUser.mockResolvedValue({} as any);

            const service = new RegistrationService(mockRepo);
            const req = {
                body: {
                    firstName: 'John',
                    lastName: 'Doe',
                    email: 'john@example.com',
                    phone: '+1234567890',
                    password: 'password123',
                }
            } as unknown as LambdaRequest;

            const result = await service.register(req);
            expect(result.email).toBe('john@example.com');
            expect(result.phone).toBe('+1234567890');
            expect(result.status).toBe('ACTIVE');
            expect(mockRepo.createUser).toHaveBeenCalled();
        });

        it('throws if email exists', async () => {
            mockRepo.getUserByEmail.mockResolvedValue({ userId: '123' } as any);

            const service = new RegistrationService(mockRepo);
            const req = {
                body: {
                    firstName: 'John',
                    lastName: 'Doe',
                    email: 'john@example.com',
                    password: 'password123',
                }
            } as unknown as LambdaRequest;

            await expect(service.register(req)).rejects.toThrow(UserAlreadyExistsException);
        });
    });

    describe('AuthenticationService', () => {
        it('logs in active user successfully', async () => {
            const storedHash = crypto.pbkdf2Sync('password123', 'salt', 10000, 64, 'sha512').toString('hex');
            mockRepo.getUserByEmail.mockResolvedValue({
                userId: 'u-123',
                email: 'john@example.com',
                passwordHash: `salt:${storedHash}`,
                status: 'ACTIVE',
                roleId: 'user',
            } as any);

            const service = new AuthenticationService(mockRepo);
            const req = {
                body: { username: 'john@example.com', password: 'password123' },
                event: { requestContext: { identity: { sourceIp: '127.0.0.1' } } },
                headers: { 'User-Agent': 'Mozilla' },
            } as unknown as LambdaRequest;

            const result = await service.postlogin(req);
            expect(result.accessToken).toBeDefined();
            expect(result.refreshToken).toBeDefined();
            expect(result.tokenType).toBe('Bearer');
            expect(mockRepo.createSession).toHaveBeenCalled();
            expect(mockRepo.saveLoginHistory).toHaveBeenCalled();
        });

        it('throws error for invalid password', async () => {
            mockRepo.getUserByEmail.mockResolvedValue({
                userId: 'u-123',
                email: 'john@example.com',
                passwordHash: 'salt:wronghash',
                status: 'ACTIVE',
            } as any);

            const service = new AuthenticationService(mockRepo);
            const req = {
                body: { username: 'john@example.com', password: 'password123' },
            } as unknown as LambdaRequest;

            await expect(service.postlogin(req)).rejects.toThrow(BaseError);
        });

        it('refreshes token successfully', async () => {
            mockRepo.getRefreshToken.mockResolvedValue({
                userId: 'u-123',
                sessionId: 's-999',
                status: 'ACTIVE',
                expiresAt: new Date(Date.now() + 100000).toISOString(),
            } as any);
            mockRepo.getUser.mockResolvedValue({
                userId: 'u-123',
                email: 'john@example.com',
                status: 'ACTIVE',
                roleId: 'user',
            } as any);

            const service = new AuthenticationService(mockRepo);
            const req = {
                body: { refreshToken: 'token123' }
            } as unknown as LambdaRequest;

            const result = await service.postrefreshtoken(req);
            expect(result.accessToken).toBeDefined();
            expect(result.refreshToken).toBe('token123');
        });
    });

    describe('OtpService', () => {
        it('sends OTP successfully', async () => {
            mockRepo.getUserByEmail.mockResolvedValue({ userId: 'u-123', email: 'john@example.com' } as any);
            mockRepo.createOtp.mockResolvedValue({} as any);

            const service = new OtpService(mockRepo);
            const req = {
                body: { destination: 'john@example.com' }
            } as unknown as LambdaRequest;

            const result = await service.postsend(req);
            expect(result.success).toBe(true);
            expect(result.referenceId).toBeDefined();
            expect(mockRepo.createOtp).toHaveBeenCalled();
        });

        it('verifies OTP successfully', async () => {
            mockRepo.getUserByEmail.mockResolvedValue({ userId: 'u-123', email: 'john@example.com' } as any);
            mockRepo.verifyOtp.mockResolvedValue(true);

            const service = new OtpService(mockRepo);
            const req = {
                body: { destination: 'john@example.com', otp: '123456' }
            } as unknown as LambdaRequest;

            await service.postverify(req);
            expect(mockRepo.verifyOtp).toHaveBeenCalled();
        });
    });

    describe('ProfileService', () => {
        it('gets current profile', async () => {
            mockProfileRepo.getProfile.mockResolvedValue({ userId: 'u-123', firstName: 'John', lastName: 'Doe' });

            const service = new ProfileService(mockProfileRepo);
            const req = {
                context: { userContext: { userId: 'u-123' } }
            } as unknown as LambdaRequest;

            const result = await service.getme(req);
            expect(result.firstName).toBe('John');
        });
    });

    describe('SessionsService', () => {
        it('lists sessions', async () => {
            mockRepo.listSessions.mockResolvedValue([{ sessionId: 's-1' }] as any);

            const service = new SessionsService(mockRepo);
            const req = {
                context: { userContext: { userId: 'u-123' } }
            } as unknown as LambdaRequest;

            const result = await service.getsessions(req);
            expect(result).toHaveLength(1);
        });
    });
});
