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
import type { CognitoAuthClient } from '@api-hub/authentication-core';
import crypto from 'crypto';

describe('Services Unit Tests', () => {
    let mockRepo: jest.Mocked<IdentityRepository>;
    let mockProfileRepo: jest.Mocked<ProfileRepository>;
    let mockCognito: jest.Mocked<CognitoAuthClient>;

    const cognitoTokens = {
        accessToken: 'cognito-access',
        refreshToken: 'cognito-refresh',
        expiresIn: 3600,
        tokenType: 'Bearer',
    };

    beforeEach(() => {
        mockRepo = {
            getUser: jest.fn(),
            getUserByEmail: jest.fn(),
            getUserByPhone: jest.fn(),
            getUserByUsername: jest.fn(),
            getUserByIdentityId: jest.fn(),
            linkIdentity: jest.fn(),
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
            getUserRoles: jest.fn().mockResolvedValue([]),
            ensureUserRoleMapping: jest.fn().mockResolvedValue('created'),
            deleteUserRoleMapping: jest.fn().mockResolvedValue('deleted'),
            listRoles: jest.fn(),
            listPermissions: jest.fn(),
            hasPermission: jest.fn(),
        } as unknown as jest.Mocked<IdentityRepository>;

        mockCognito = {
            findOrCreateUser: jest.fn().mockResolvedValue({
                sub: 'cognito-sub-1',
                username: 'bow_user',
            }),
            issueTokens: jest.fn().mockResolvedValue(cognitoTokens),
            refreshTokens: jest.fn().mockResolvedValue(cognitoTokens),
            signOut: jest.fn().mockResolvedValue(undefined),
        };

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
            expect(result.roles).toEqual(['CUSTOMER']);
            expect(mockRepo.createUser).toHaveBeenCalled();
            expect(mockRepo.ensureUserRoleMapping).toHaveBeenCalledWith(
                expect.stringMatching(/^u-/),
                'CUSTOMER',
            );
            const created = mockRepo.createUser.mock.calls[0][0] as User;
            expect(created.roleId).toBe('user');
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

        it('creates a mobile OTP identity without a password or email', async () => {
            mockRepo.createUser.mockImplementation(async (user) => user);

            const service = new RegistrationService(mockRepo);
            const result = await service.createIdentity({
                phoneNumber: '+1234567890',
                phoneVerified: true,
            });

            expect(result.phoneNumber).toBe('+1234567890');
            expect(result.phoneVerified).toBe(true);
            expect(result.email).toBe('');
            expect(result.emailVerified).toBe(false);
            expect(result.username).toBe('+1234567890');
            expect(result.status).toBe('ACTIVE');
            expect(result.roleId).toBe('user');
            expect(result.passwordHash).toContain(':');
            expect(mockRepo.createUser).toHaveBeenCalled();
            expect(mockRepo.ensureUserRoleMapping).toHaveBeenCalledWith(
                result.userId,
                'CUSTOMER',
            );
        });
    });

    describe('AuthenticationService', () => {
        it('logs in active user successfully', async () => {
            const storedHash = crypto.pbkdf2Sync('password123', 'salt', 10000, 64, 'sha512').toString('hex');
            const linkedUser = {
                userId: 'u-123',
                email: 'john@example.com',
                passwordHash: `salt:${storedHash}`,
                status: 'ACTIVE',
                roleId: 'user',
                identityId: 'cognito-sub-1',
                cognitoUsername: 'bow_user',
            };
            mockRepo.getUserByEmail.mockResolvedValue(linkedUser as any);
            mockRepo.getUserByIdentityId.mockResolvedValue(linkedUser as any);

            const service = new AuthenticationService(mockRepo, mockCognito);
            const req = {
                body: { username: 'john@example.com', password: 'password123' },
                event: { requestContext: { identity: { sourceIp: '127.0.0.1' } } },
                headers: { 'User-Agent': 'Mozilla' },
            } as unknown as LambdaRequest;

            const result = await service.postlogin(req);
            expect(result.accessToken).toBe('cognito-access');
            expect(result.refreshToken).toBe('cognito-refresh');
            expect(result.tokenType).toBe('Bearer');
            expect(mockCognito.issueTokens).toHaveBeenCalledWith('bow_user');
            expect(mockRepo.ensureUserRoleMapping).toHaveBeenCalledWith('u-123', 'CUSTOMER');
            expect(mockRepo.ensureUserRoleMapping.mock.invocationCallOrder[0]).toBeLessThan(
                mockCognito.issueTokens.mock.invocationCallOrder[0],
            );
            expect(mockRepo.createSession).toHaveBeenCalled();
            expect(mockRepo.saveLoginHistory).toHaveBeenCalled();
        });

        it('does not replace an existing VENDOR role with CUSTOMER at login', async () => {
            const storedHash = crypto.pbkdf2Sync('password123', 'salt', 10000, 64, 'sha512').toString('hex');
            const linkedUser = {
                userId: 'u-123',
                email: 'john@example.com',
                passwordHash: `salt:${storedHash}`,
                status: 'ACTIVE',
                roleId: 'VENDOR',
                identityId: 'cognito-sub-1',
                cognitoUsername: 'bow_user',
            };
            mockRepo.getUserByEmail.mockResolvedValue(linkedUser as any);
            mockRepo.getUserByIdentityId.mockResolvedValue(linkedUser as any);
            mockRepo.getUserRoles.mockResolvedValue(['VENDOR']);

            const service = new AuthenticationService(mockRepo, mockCognito);
            await service.postlogin({
                body: { username: 'john@example.com', password: 'password123' },
                event: { requestContext: { identity: { sourceIp: '127.0.0.1' } } },
                headers: {},
            } as unknown as LambdaRequest);

            expect(mockRepo.ensureUserRoleMapping).not.toHaveBeenCalled();
            expect(mockCognito.issueTokens).toHaveBeenCalledWith('bow_user');
        });

        it('rejects a password that only matches the stored hash text', () => {
            expect(verifyPassword('plaintext-secret', 'plaintext-secret')).toBe(false);
        });

        it('throws error for invalid password', async () => {
            mockRepo.getUserByEmail.mockResolvedValue({
                userId: 'u-123',
                email: 'john@example.com',
                passwordHash: 'salt:wronghash',
                status: 'ACTIVE',
            } as any);

            const service = new AuthenticationService(mockRepo, mockCognito);
            const req = {
                body: { username: 'john@example.com', password: 'password123' },
            } as unknown as LambdaRequest;

            await expect(service.postlogin(req)).rejects.toThrow(BaseError);
            expect(mockCognito.issueTokens).not.toHaveBeenCalled();
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
            mockCognito.refreshTokens.mockResolvedValue({
                accessToken: 'cognito-access',
                refreshToken: 'token123',
                expiresIn: 3600,
                tokenType: 'Bearer',
            });

            const service = new AuthenticationService(mockRepo, mockCognito);
            const req = {
                body: { refreshToken: 'token123' }
            } as unknown as LambdaRequest;

            const result = await service.postrefreshtoken(req);
            expect(result.accessToken).toBe('cognito-access');
            expect(result.refreshToken).toBe('token123');
            expect(mockRepo.ensureUserRoleMapping).toHaveBeenCalledWith('u-123', 'CUSTOMER');
            expect(mockRepo.ensureUserRoleMapping.mock.invocationCallOrder[0]).toBeLessThan(
                mockCognito.refreshTokens.mock.invocationCallOrder[0],
            );
        });

        it('rejects an unknown refresh token', async () => {
            mockRepo.getRefreshToken.mockResolvedValue(null);
            const service = new AuthenticationService(mockRepo, mockCognito);

            await expect(
                service.postrefreshtoken({
                    body: { refreshToken: 'not-a-session' },
                } as unknown as LambdaRequest),
            ).rejects.toMatchObject({
                statusCode: 401,
                code: 'INVALID_REFRESH_TOKEN',
            });
            expect(mockCognito.refreshTokens).not.toHaveBeenCalled();
        });

        it('rejects an expired refresh token', async () => {
            mockRepo.getRefreshToken.mockResolvedValue({
                userId: 'u-123',
                sessionId: 's-999',
                status: 'ACTIVE',
                expiresAt: new Date(Date.now() - 1000).toISOString(),
            } as any);
            const service = new AuthenticationService(mockRepo, mockCognito);

            await expect(
                service.postrefreshtoken({
                    body: { refreshToken: 'expired-token' },
                } as unknown as LambdaRequest),
            ).rejects.toMatchObject({
                statusCode: 401,
                code: 'INVALID_REFRESH_TOKEN',
            });
            expect(mockCognito.refreshTokens).not.toHaveBeenCalled();
        });

        it('logs out and signs the Cognito user out globally', async () => {
            mockRepo.getUser.mockResolvedValue({
                userId: 'u-123',
                cognitoUsername: 'bow_user',
            } as any);

            const service = new AuthenticationService(mockRepo, mockCognito);
            const req = {
                context: {
                    userContext: { userId: 'u-123' },
                    authHeader: 'Bearer cognito-access',
                },
            } as unknown as LambdaRequest;

            await service.postlogout(req);
            expect(mockCognito.signOut).toHaveBeenCalledWith('bow_user');
            expect(mockRepo.deleteAllSessions).toHaveBeenCalledWith('u-123');
        });

        it('persists IDENTITY lookup when the user object already has Cognito fields', async () => {
            const storedHash = crypto.pbkdf2Sync('password123', 'salt', 10000, 64, 'sha512').toString('hex');
            mockRepo.getUserByEmail.mockResolvedValue({
                userId: 'u-123',
                email: 'john@example.com',
                passwordHash: `salt:${storedHash}`,
                status: 'ACTIVE',
                roleId: 'user',
                identityId: 'cognito-sub-1',
                cognitoUsername: 'bow_user',
            } as any);
            mockRepo.getUserByIdentityId.mockResolvedValue(null);
            mockRepo.linkIdentity.mockResolvedValue({
                userId: 'u-123',
                identityId: 'cognito-sub-1',
                cognitoUsername: 'bow_user',
                status: 'ACTIVE',
            } as any);

            const service = new AuthenticationService(mockRepo, mockCognito);
            await service.postlogin({
                body: { username: 'john@example.com', password: 'password123' },
                event: { requestContext: { identity: { sourceIp: '127.0.0.1' } } },
                headers: {},
            } as unknown as LambdaRequest);

            expect(mockRepo.linkIdentity).toHaveBeenCalledWith(
                'u-123',
                'cognito-sub-1',
                'bow_user',
            );
            expect(mockCognito.issueTokens).toHaveBeenCalledWith('bow_user');
        });
    });

    describe('OtpService', () => {
        const activeUser = {
            userId: 'u-123',
            email: 'john@example.com',
            username: 'john@example.com',
            phoneNumber: '+1234567890',
            passwordHash: 'salt:hash',
            status: 'ACTIVE',
            roleId: 'user',
            emailVerified: false,
            phoneVerified: false,
            version: 1,
        };

        const otpService = () =>
            new OtpService(mockRepo, undefined, undefined, mockCognito);

        const hashOtp = (code: string) =>
            crypto.createHash('sha256').update(code).digest('hex');

        const originalStage = process.env.STAGE;
        const originalOtpDevCode = process.env.OTP_DEV_CODE;
        let randomIntSpy: jest.SpyInstance | undefined;

        beforeEach(() => {
            mockRepo.createSession.mockResolvedValue({} as Session);
            mockRepo.saveLoginHistory.mockResolvedValue(undefined);
            mockRepo.getUserByIdentityId.mockResolvedValue(null);
            mockRepo.linkIdentity.mockImplementation(async (userId, identityId, cognitoUsername) => ({
                ...activeUser,
                userId,
                identityId,
                cognitoUsername,
            } as User));
            mockRepo.updateUser.mockImplementation(async (user) => ({
                ...user,
                version: user.version + 1,
            }));
            mockRepo.createUser.mockImplementation(async (user) => user);
        });

        afterEach(() => {
            randomIntSpy?.mockRestore();
            randomIntSpy = undefined;
            if (originalStage === undefined) {
                delete process.env.STAGE;
            } else {
                process.env.STAGE = originalStage;
            }
            if (originalOtpDevCode === undefined) {
                delete process.env.OTP_DEV_CODE;
            } else {
                process.env.OTP_DEV_CODE = originalOtpDevCode;
            }
        });

        it('sends OTP successfully without persisting the code', async () => {
            mockRepo.createOtp.mockResolvedValue({} as any);

            const service = otpService();
            const req = {
                body: { destination: 'john@example.com' }
            } as unknown as LambdaRequest;

            const result = await service.postsend(req);
            expect(result.success).toBe(true);
            expect(result.referenceId).toBeDefined();
            const saved = mockRepo.createOtp.mock.calls[0][0] as Otp;
            expect(saved.otpCode).toBeUndefined();
            expect(saved.codeHash).toBeDefined();
        });

        it('hashes OTP_DEV_CODE in the dev stage instead of generating a random OTP', async () => {
            process.env.STAGE = 'dev';
            process.env.OTP_DEV_CODE = '123456';
            randomIntSpy = jest.spyOn(crypto, 'randomInt');
            mockRepo.createOtp.mockResolvedValue({} as any);

            const service = otpService();
            await service.postsend({
                body: { destination: 'john@example.com' },
            } as unknown as LambdaRequest);

            expect(randomIntSpy).not.toHaveBeenCalled();
            const saved = mockRepo.createOtp.mock.calls[0][0] as Otp;
            expect(saved.otpCode).toBeUndefined();
            expect(saved.codeHash).toBe(hashOtp('123456'));
            expect(saved.expiresAt).toBeDefined();
            expect(saved.ttl).toBeDefined();
        });

        it('hashes a custom OTP_DEV_CODE in the test stage', async () => {
            process.env.STAGE = 'test';
            process.env.OTP_DEV_CODE = '999111';
            randomIntSpy = jest.spyOn(crypto, 'randomInt');
            mockRepo.createOtp.mockResolvedValue({} as any);

            const service = otpService();
            await service.postsend({
                body: { destination: '+1234567890' },
            } as unknown as LambdaRequest);

            expect(randomIntSpy).not.toHaveBeenCalled();
            const saved = mockRepo.createOtp.mock.calls[0][0] as Otp;
            expect(saved.codeHash).toBe(hashOtp('999111'));
            expect(saved.codeHash).not.toBe(hashOtp('123456'));
        });

        it('generates a random OTP in production even when OTP_DEV_CODE is set', async () => {
            process.env.STAGE = 'prod';
            process.env.OTP_DEV_CODE = '123456';
            randomIntSpy = jest.spyOn(crypto, 'randomInt').mockReturnValue(654321 as never);
            mockRepo.createOtp.mockResolvedValue({} as any);

            const service = otpService();
            await service.postsend({
                body: { destination: 'john@example.com' },
            } as unknown as LambdaRequest);

            expect(randomIntSpy).toHaveBeenCalledWith(100000, 1000000);
            const saved = mockRepo.createOtp.mock.calls[0][0] as Otp;
            expect(saved.otpCode).toBeUndefined();
            expect(saved.codeHash).toBe(hashOtp('654321'));
            expect(saved.codeHash).not.toBe(hashOtp('123456'));
        });

        it('generates a random OTP in staging and never uses OTP_DEV_CODE', async () => {
            process.env.STAGE = 'staging';
            process.env.OTP_DEV_CODE = '123456';
            randomIntSpy = jest.spyOn(crypto, 'randomInt').mockReturnValue(111222 as never);
            mockRepo.createOtp.mockResolvedValue({} as any);

            const service = otpService();
            await service.postsend({
                body: { destination: 'john@example.com' },
            } as unknown as LambdaRequest);

            expect(randomIntSpy).toHaveBeenCalledWith(100000, 1000000);
            const saved = mockRepo.createOtp.mock.calls[0][0] as Otp;
            expect(saved.codeHash).toBe(hashOtp('111222'));
            expect(saved.codeHash).not.toBe(hashOtp('123456'));
        });

        it('issues tokens for a valid OTP and existing mobile identity', async () => {
            mockRepo.verifyOtp.mockResolvedValue(true);
            mockRepo.getUserByPhone.mockResolvedValue({
                ...activeUser,
                email: '',
                username: '+1234567890',
            } as User);

            const service = otpService();
            const req = {
                body: { destination: '+1234567890', otp: '123456' },
                event: { requestContext: { identity: { sourceIp: '127.0.0.1' } }, headers: {} },
            } as unknown as LambdaRequest;

            const result = await service.postverify(req);
            expect(result.accessToken).toBe('cognito-access');
            expect(result.refreshToken).toBe('cognito-refresh');
            expect(result.tokenType).toBe('Bearer');
            expect(mockRepo.verifyOtp).toHaveBeenCalled();
            expect(mockCognito.findOrCreateUser).toHaveBeenCalledWith({
                phoneNumber: '+1234567890',
            });
            expect(mockRepo.updateUser).toHaveBeenCalledWith(
                expect.objectContaining({ phoneVerified: true }),
                1,
            );
            expect(mockRepo.linkIdentity).toHaveBeenCalledWith(
                'u-123',
                'cognito-sub-1',
                'bow_user',
            );
            expect(mockRepo.createSession).toHaveBeenCalled();
            expect(mockRepo.createUser).not.toHaveBeenCalled();
        });

        it('creates a mobile identity and issues tokens for a valid OTP', async () => {
            mockRepo.verifyOtp.mockResolvedValue(true);
            mockRepo.getUserByPhone.mockResolvedValue(null);

            const service = otpService();
            const req = {
                body: { destination: '+1234567890', otp: '123456' },
                event: { requestContext: { identity: { sourceIp: '127.0.0.1' } }, headers: {} },
            } as unknown as LambdaRequest;

            const result = await service.postverify(req);
            expect(result.accessToken).toBe('cognito-access');
            expect(mockRepo.createUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    phoneNumber: '+1234567890',
                    phoneVerified: true,
                    email: '',
                    emailVerified: false,
                    status: 'ACTIVE',
                    roleId: 'user',
                    identityId: 'cognito-sub-1',
                }),
                expect.objectContaining({ firstName: '', lastName: '' }),
            );
            expect(mockRepo.createSession).toHaveBeenCalled();
            expect(mockRepo.ensureUserRoleMapping).toHaveBeenCalledWith(
                expect.stringMatching(/^u-/),
                'CUSTOMER',
            );
            expect(mockRepo.ensureUserRoleMapping.mock.invocationCallOrder[0]).toBeLessThan(
                mockCognito.issueTokens.mock.invocationCallOrder[0],
            );
        });

        it('issues tokens for a valid OTP and existing email identity', async () => {
            mockRepo.verifyOtp.mockResolvedValue(true);
            mockRepo.getUserByEmail.mockResolvedValue(activeUser as User);

            const service = otpService();
            const req = {
                body: { destination: 'john@example.com', otp: '123456' },
                event: { requestContext: { identity: { sourceIp: '127.0.0.1' } }, headers: {} },
            } as unknown as LambdaRequest;

            const result = await service.postverify(req);
            expect(result.accessToken).toBe('cognito-access');
            expect(mockRepo.updateUser).toHaveBeenCalledWith(
                expect.objectContaining({ emailVerified: true }),
                1,
            );
            expect(mockRepo.linkIdentity).toHaveBeenCalledWith(
                'u-123',
                'cognito-sub-1',
                'bow_user',
            );
            expect(mockRepo.createSession).toHaveBeenCalled();
            expect(mockRepo.createUser).not.toHaveBeenCalled();
        });

        it('creates an email identity and issues tokens for a valid OTP', async () => {
            mockRepo.verifyOtp.mockResolvedValue(true);
            mockRepo.getUserByEmail.mockResolvedValue(null);

            const service = otpService();
            const req = {
                body: { destination: 'new@example.com', otp: '123456' },
                event: { requestContext: { identity: { sourceIp: '127.0.0.1' } }, headers: {} },
            } as unknown as LambdaRequest;

            const result = await service.postverify(req);
            expect(result.accessToken).toBeDefined();
            expect(mockRepo.createUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    email: 'new@example.com',
                    emailVerified: true,
                    phoneNumber: '',
                    phoneVerified: false,
                    status: 'ACTIVE',
                    roleId: 'user',
                    identityId: 'cognito-sub-1',
                }),
                expect.any(Object),
            );
            expect(mockRepo.createSession).toHaveBeenCalled();
        });

        it('throws INVALID_OTP for an invalid OTP without creating an identity', async () => {
            mockRepo.verifyOtp.mockResolvedValue(false);

            const service = otpService();
            const req = {
                body: { destination: '+1234567890', otp: '000000' }
            } as unknown as LambdaRequest;

            await expect(service.postverify(req)).rejects.toMatchObject({
                code: 'INVALID_OTP',
                statusCode: 400,
            });
            expect(mockCognito.findOrCreateUser).not.toHaveBeenCalled();
            expect(mockRepo.getUserByPhone).not.toHaveBeenCalled();
            expect(mockRepo.createUser).not.toHaveBeenCalled();
            expect(mockRepo.createSession).not.toHaveBeenCalled();
        });

        it('throws INVALID_OTP for an expired OTP', async () => {
            mockRepo.verifyOtp.mockResolvedValue(false);

            const service = otpService();
            const req = {
                body: { destination: 'john@example.com', otp: '123456' }
            } as unknown as LambdaRequest;

            await expect(service.postverify(req)).rejects.toThrow(BaseError);
            await expect(service.postverify(req)).rejects.toMatchObject({
                code: 'INVALID_OTP',
            });
            expect(mockRepo.createUser).not.toHaveBeenCalled();
        });

        it('authenticates the existing identity when concurrent create races', async () => {
            const existingMobile = {
                ...activeUser,
                email: '',
                username: '+1234567890',
                phoneVerified: true,
                identityId: 'cognito-sub-1',
                cognitoUsername: 'bow_user',
            } as User;
            mockRepo.verifyOtp.mockResolvedValue(true);
            mockRepo.getUserByPhone
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(existingMobile);
            mockRepo.createUser.mockRejectedValue(
                new UserAlreadyExistsException('User registration failed due to conflicting email, phone, or username.'),
            );

            const service = otpService();
            const req = {
                body: { destination: '+1234567890', otp: '123456' },
                event: { requestContext: { identity: { sourceIp: '127.0.0.1' } }, headers: {} },
            } as unknown as LambdaRequest;

            const result = await service.postverify(req);
            expect(result.accessToken).toBe('cognito-access');
            expect(mockRepo.createSession).toHaveBeenCalled();
            expect(mockRepo.getUserByPhone).toHaveBeenCalledTimes(2);
        });

        it('reuses an existing Cognito identity instead of creating a duplicate', async () => {
            mockRepo.verifyOtp.mockResolvedValue(true);
            mockRepo.getUserByIdentityId.mockResolvedValue({
                ...activeUser,
                identityId: 'cognito-sub-1',
                cognitoUsername: 'bow_user',
                phoneVerified: true,
            } as User);

            const service = otpService();
            const req = {
                body: { destination: '+1234567890', otp: '123456' },
                event: { requestContext: { identity: { sourceIp: '127.0.0.1' } }, headers: {} },
            } as unknown as LambdaRequest;

            const result = await service.postverify(req);
            expect(result.accessToken).toBe('cognito-access');
            expect(mockRepo.createUser).not.toHaveBeenCalled();
            expect(mockCognito.findOrCreateUser).toHaveBeenCalledTimes(1);
        });
    });

    describe('ProfileService', () => {
        it('gets current profile merged with user fields (no passwordHash)', async () => {
            mockProfileRepo.getProfile.mockResolvedValue({
                userId: 'u-123',
                firstName: 'John',
                lastName: 'Doe',
                createdAt: '2026-07-15T04:40:40.916Z',
                updatedAt: '2026-07-15T04:40:40.916Z',
            });
            mockProfileRepo.getUser.mockResolvedValue({
                userId: 'u-123',
                email: 'customer@yopmail.com',
                username: 'customer@yopmail.com',
                phoneNumber: '+919037744904',
                passwordHash: 'secret:hash',
                status: 'ACTIVE',
                emailVerified: false,
                phoneVerified: false,
                version: 1,
                roleId: 'user',
                createdAt: '2026-07-15T04:40:40.914Z',
                updatedAt: '2026-07-15T04:40:40.914Z',
            } as User);

            const service = new ProfileService(mockProfileRepo);
            const req = {
                context: { userContext: { userId: 'u-123' } }
            } as unknown as LambdaRequest;

            const result = await service.getme(req);
            expect(result).toMatchObject({
                userId: 'u-123',
                firstName: 'John',
                lastName: 'Doe',
                email: 'customer@yopmail.com',
                phoneNumber: '+919037744904',
                username: 'customer@yopmail.com',
                status: 'ACTIVE',
                roleId: 'user',
                emailVerified: false,
                phoneVerified: false,
                version: 1,
            });
            expect(result).not.toHaveProperty('passwordHash');
            expect(result).not.toHaveProperty('PK');
            expect(result).not.toHaveProperty('SK');
        });

        it('rejects /me when the token has no user', async () => {
            const service = new ProfileService(mockProfileRepo);

            await expect(
                service.getme({
                    context: { userContext: {} },
                } as unknown as LambdaRequest),
            ).rejects.toMatchObject({
                statusCode: 401,
                code: 'UNAUTHORIZED',
            });
            expect(mockProfileRepo.getUser).not.toHaveBeenCalled();
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

    describe('RolesService admin assignment', () => {
        function request(roles: string[], body: unknown): LambdaRequest {
            return {
                params: { userId: 'u-123' },
                body,
                context: { authContext: { identityId: 'sub-1', roles } },
            } as unknown as LambdaRequest;
        }

        it('stores ADMIN only when the caller already has ADMIN', async () => {
            mockRepo.getUserRoles.mockResolvedValue(['CUSTOMER', 'ADMIN']);
            const service = new RolesService(mockRepo as any);
            const result = await service.assignAdminRole(request(['ADMIN'], { role: 'ADMIN' }));
            expect(mockRepo.ensureUserRoleMapping).toHaveBeenCalledWith('u-123', 'ADMIN');
            expect(result.roles).toEqual(['CUSTOMER', 'ADMIN']);
        });

        it('rejects a customer assigning ADMIN', async () => {
            const service = new RolesService(mockRepo as any);
            await expect(
                service.assignAdminRole(request(['CUSTOMER'], { role: 'ADMIN' })),
            ).rejects.toMatchObject({ statusCode: 403 });
            expect(mockRepo.ensureUserRoleMapping).not.toHaveBeenCalled();
        });

        it('rejects assigning VENDOR through the admin operation', async () => {
            const service = new RolesService(mockRepo as any);
            await expect(
                service.assignAdminRole(request(['ADMIN'], { role: 'VENDOR' })),
            ).rejects.toMatchObject({ statusCode: 400, code: 'ROLE_NOT_ASSIGNABLE' });
            expect(mockRepo.ensureUserRoleMapping).not.toHaveBeenCalled();
        });

        it('removes ADMIN and leaves other mappings', async () => {
            mockRepo.getUserRoles.mockResolvedValue(['CUSTOMER']);
            const service = new RolesService(mockRepo as any);
            const result = await service.revokeAdminRole({
                params: { userId: 'u-123', role: 'ADMIN' },
                context: { authContext: { identityId: 'sub-1', roles: ['ADMIN'] } },
            } as unknown as LambdaRequest);
            expect(mockRepo.deleteUserRoleMapping).toHaveBeenCalledWith('u-123', 'ADMIN');
            expect(result.roles).toEqual(['CUSTOMER']);
        });
    });
});
