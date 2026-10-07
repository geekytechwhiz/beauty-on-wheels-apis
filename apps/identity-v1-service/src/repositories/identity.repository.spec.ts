import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { IdentityRepository } from './identity.repository';
import { User, Profile, Session, Otp, Role, Permission, LoginHistory, AuditLog, UserAlreadyExistsException } from '../types/repository.types';
import { ConditionalWriteConflictError } from '@api-hub/utils';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('IdentityRepository', () => {
  let repository: IdentityRepository;

  const mockUser: User = {
    userId: 'u-123',
    email: 'test@example.com',
    username: 'testuser',
    phoneNumber: '+1234567890',
    passwordHash: 'hashed-password',
    status: 'active',
    emailVerified: false,
    phoneVerified: false,
    version: 1,
    roleId: 'admin',
  };

  const mockProfile: Profile = {
    userId: 'u-123',
    firstName: 'John',
    lastName: 'Doe',
  };

  const mockSession: Session = {
    sessionId: 's-999',
    userId: 'u-123',
    refreshTokenHash: 'hash-abc',
    status: 'active',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };

  const mockOtp: Otp = {
    otpId: 'o-111',
    destination: '+1234567890',
    purpose: 'login',
    referenceId: 'ref-xyz',
    codeHash: 'code-hash',
    attempts: 0,
    verified: false,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  };

  const mockRole: Role = {
    roleId: 'admin',
    name: 'Administrator',
    description: 'System Admin',
  };

  const mockPermission: Permission = {
    roleId: 'admin',
    permissionId: 'write:users',
    name: 'Write Users',
  };

  const mockLoginHistory: LoginHistory = {
    userId: 'u-123',
    timestamp: new Date().toISOString(),
    status: 'success',
  };

  const mockAudit: AuditLog = {
    auditId: 'a-555',
    userId: 'u-123',
    action: 'delete_user',
    timestamp: new Date().toISOString(),
  };

  beforeEach(() => {
    ddbMock.reset();
    repository = new IdentityRepository();
  });

  describe('User Methods', () => {
    it('creates a user successfully with optional profile', async () => {
      ddbMock.on(TransactWriteCommand).resolves({});

      const result = await repository.createUser(mockUser, mockProfile, 'tenant-1');

      expect(result).toEqual(mockUser);
      expect(ddbMock.calls().length).toBe(1);
    });

    it('throws UserAlreadyExistsException when transaction write fails', async () => {
      ddbMock.on(TransactWriteCommand).rejects(new Error('Conditional check failed'));

      await expect(repository.createUser(mockUser)).rejects.toThrow(UserAlreadyExistsException);
    });

    it('skips empty email and phone uniqueness lookups', async () => {
      ddbMock.on(TransactWriteCommand).resolves({});

      const mobileOnlyUser: User = {
        ...mockUser,
        email: '',
        username: '+1234567890',
        phoneNumber: '+1234567890',
        emailVerified: false,
        phoneVerified: true,
      };

      await repository.createUser(mobileOnlyUser);

      const transact = ddbMock.commandCalls(TransactWriteCommand)[0]?.args[0].input;
      const items = transact?.TransactItems ?? [];
      const entityTypes = items.map((item) => item.Put?.Item?.entityType);
      expect(entityTypes).toContain('User');
      expect(entityTypes).toContain('PhoneLookup');
      expect(entityTypes).toContain('UsernameLookup');
      expect(entityTypes).not.toContain('EmailLookup');
    });

    it('writes IDENTITY lookup when creating a user with identityId', async () => {
      ddbMock.on(TransactWriteCommand).resolves({});

      await repository.createUser({
        ...mockUser,
        identityId: 'cognito-sub-1',
        cognitoUsername: 'bow_user',
      });

      const transact = ddbMock.commandCalls(TransactWriteCommand)[0]?.args[0].input;
      const identityPut = transact?.TransactItems?.find(
        (item) => item.Put?.Item?.entityType === 'IdentityLookup',
      );
      expect(identityPut?.Put?.Item).toMatchObject({
        PK: 'IDENTITY#cognito-sub-1',
        SK: 'LOOKUP',
        userId: 'u-123',
        identityId: 'cognito-sub-1',
      });
    });

    it('gets user metadata by userId', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          PK: 'USER#u-123',
          SK: 'META',
          userId: 'u-123',
          email: 'test@example.com',
          username: 'testuser',
          phoneNumber: '+1234567890',
          passwordHash: 'hashed-password',
          status: 'active',
          emailVerified: false,
          phoneVerified: false,
          version: 1,
        },
      });

      const user = await repository.getUser('u-123');
      expect(user).not.toBeNull();
      expect(user?.email).toBe('test@example.com');
    });

    it('returns null when user is missing', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      const user = await repository.getUser('u-missing');
      expect(user).toBeNull();
    });

    it('retrieves user by email via GSI1', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'u-123' }],
      });
      ddbMock.on(GetCommand).resolves({
        Item: { ...mockUser },
      });

      const user = await repository.getUserByEmail('test@example.com');
      expect(user?.userId).toBe('u-123');
    });

    it('retrieves user by phone via GSI1', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'u-123' }],
      });
      ddbMock.on(GetCommand).resolves({
        Item: { ...mockUser },
      });

      const user = await repository.getUserByPhone('+1234567890');
      expect(user?.userId).toBe('u-123');
    });

    it('retrieves user by username via GSI1', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'u-123' }],
      });
      ddbMock.on(GetCommand).resolves({
        Item: { ...mockUser },
      });

      const user = await repository.getUserByUsername('testuser');
      expect(user?.userId).toBe('u-123');
    });

    it('retrieves user by Cognito identityId', async () => {
      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: { userId: 'u-123', identityId: 'sub-1' } })
        .resolvesOnce({ Item: { ...mockUser, identityId: 'sub-1' } });

      const user = await repository.getUserByIdentityId('sub-1');
      expect(user?.userId).toBe('u-123');
    });

    it('writes IDENTITY lookup when META already has identityId', async () => {
      ddbMock
        .on(GetCommand)
        .resolvesOnce({
          Item: {
            ...mockUser,
            identityId: 'cognito-sub-1',
            cognitoUsername: 'bow_user',
          },
        })
        .resolvesOnce({});
      ddbMock.on(TransactWriteCommand).resolves({});

      const linked = await repository.linkIdentity(
        'u-123',
        'cognito-sub-1',
        'bow_user',
      );

      expect(linked.identityId).toBe('cognito-sub-1');
      const transact = ddbMock.commandCalls(TransactWriteCommand)[0]?.args[0].input;
      const identityPut = transact?.TransactItems?.find(
        (item) => item.Put?.Item?.entityType === 'IdentityLookup',
      );
      expect(identityPut?.Put?.Item).toMatchObject({
        PK: 'IDENTITY#cognito-sub-1',
        SK: 'LOOKUP',
        userId: 'u-123',
      });
      expect(transact?.TransactItems?.some((item) => item.Update)).toBe(false);
    });

    it('updates user with optimistic locking check', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const result = await repository.updateUser(mockUser, 1);
      expect(result.version).toBe(2);
    });

    it('throws ConditionalWriteConflictError on update mismatch', async () => {
      ddbMock.on(UpdateCommand).rejects({
        name: 'ConditionalCheckFailedException',
        message: 'Conditional check failed',
      });

      await expect(repository.updateUser(mockUser, 1)).rejects.toThrow(ConditionalWriteConflictError);
    });

    it('deletes user along with lookups and sessions', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockUser });
      ddbMock.on(QueryCommand).resolves({ Items: [mockSession] });
      ddbMock.on(TransactWriteCommand).resolves({});

      await repository.deleteUser('u-123');
      expect(ddbMock.calls().length).toBe(3);
    });

    it('lists users in a tenant with pagination support', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [mockUser],
        LastEvaluatedKey: { PK: 'USER#u-123', SK: 'META' },
      });

      const result = await repository.listUsersByTenant('tenant-1', 10);
      expect(result.items.length).toBe(1);
      expect(result.nextToken).toBeDefined();
    });
  });

  describe('Authentication Methods', () => {
    it('creates active session and refresh token lookup', async () => {
      ddbMock.on(TransactWriteCommand).resolves({});
      const result = await repository.createSession(mockSession);
      expect(result).toEqual(mockSession);
    });

    it('gets a session by ID', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockSession });
      const sess = await repository.getSession('u-123', 's-999');
      expect(sess?.sessionId).toBe('s-999');
    });

    it('lists all sessions for user', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [mockSession] });
      const list = await repository.listSessions('u-123');
      expect(list.length).toBe(1);
    });

    it('deletes a session', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockSession });
      ddbMock.on(TransactWriteCommand).resolves({});
      await repository.deleteSession('u-123', 's-999');
    });

    it('deletes all sessions for user', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [mockSession] });
      ddbMock.on(TransactWriteCommand).resolves({});
      await repository.deleteAllSessions('u-123');
    });

    it('creates refresh token metadata', async () => {
      ddbMock.on(PutCommand).resolves({});
      await repository.createRefreshToken('u-123', 't-777', 'hash-xyz', 'expiry');
    });

    it('resolves refresh token via GSI5', async () => {
      ddbMock.on(GetCommand).resolves({});
      ddbMock.on(QueryCommand).resolves({
        Items: [{
          entityType: 'Session',
          ...mockSession,
        }],
      });

      const resolved = await repository.getRefreshToken('hash-abc');
      expect(resolved?.sessionId).toBe('s-999');
    });

    it('resolves refresh token via lookup item', async () => {
      ddbMock
        .on(GetCommand)
        .resolvesOnce({
          Item: {
            PK: 'REFRESH#hash-abc',
            SK: 'LOOKUP',
            entityType: 'RefreshTokenLookup',
            userId: 'u-123',
            sessionId: 's-999',
          },
        })
        .resolvesOnce({ Item: mockSession });

      const resolved = await repository.getRefreshToken('hash-abc');
      expect(resolved?.sessionId).toBe('s-999');
    });

    it('deletes refresh token lookup', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [{ PK: 'REFRESH#hash', SK: 'LOOKUP' }] });
      ddbMock.on(TransactWriteCommand).resolves({});
      await repository.deleteRefreshToken('hash-abc');
    });

    it('changes password with history storage', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockUser });
      ddbMock.on(TransactWriteCommand).resolves({});
      await repository.changePassword('u-123', 'new-hash', 1);
    });

    it('stores password history row', async () => {
      ddbMock.on(PutCommand).resolves({});
      await repository.storePasswordHistory('u-123', 'old-hash');
    });
  });

  describe('OTP Methods', () => {
    it('creates and retrieves OTP', async () => {
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(GetCommand).resolves({ Item: mockOtp });

      await repository.createOtp(mockOtp);
      const fetched = await repository.getLatestOtp('+1234567890', 'login');
      expect(fetched?.otpId).toBe('o-111');
    });

    it('verifies valid OTP', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockOtp });
      ddbMock.on(UpdateCommand).resolves({});

      const verified = await repository.verifyOtp('+1234567890', 'login', 'code-hash');
      expect(verified).toBe(true);
    });

    it('rejects verification for incorrect or expired OTP', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      const verified = await repository.verifyOtp('+1234567890', 'login', 'wrong-code');
      expect(verified).toBe(false);
    });

    it('rejects an expired OTP even when the hash matches', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          ...mockOtp,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      });

      const verified = await repository.verifyOtp('+1234567890', 'login', 'code-hash');
      expect(verified).toBe(false);
    });

    it('allows idempotent re-verify of a matching unexpired OTP', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          ...mockOtp,
          verified: true,
        },
      });

      const verified = await repository.verifyOtp('+1234567890', 'login', 'code-hash');
      expect(verified).toBe(true);
    });

    it('deletes OTP record', async () => {
      ddbMock.on(DeleteCommand).resolves({});
      await repository.deleteOtp('+1234567890', 'login');
    });
  });

  describe('Roles & Permissions Methods', () => {
    it('assigns role to a user', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockUser });
      ddbMock.on(TransactWriteCommand).resolves({});
      await repository.assignRole('u-123', 'admin');
    });

    it('removes role from a user', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockUser });
      ddbMock.on(TransactWriteCommand).resolves({});
      await repository.removeRole('u-123', 'admin');
    });

    it('creates a USER# ROLE# mapping without changing the profile role', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { ...mockUser, PK: 'USER#u-123', SK: 'META' },
      });
      ddbMock.on(PutCommand).resolves({});

      await expect(repository.ensureUserRoleMapping('u-123', 'CUSTOMER')).resolves.toBe(
        'created',
      );

      const input = ddbMock.commandCalls(PutCommand)[0].args[0].input;
      expect(input.Item).toEqual(
        expect.objectContaining({
          PK: 'USER#u-123',
          SK: 'ROLE#CUSTOMER',
          userId: 'u-123',
          roleId: 'CUSTOMER',
          entityType: 'UserRole',
        }),
      );
      expect(input.ConditionExpression).toBe('attribute_not_exists(PK)');
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('does not create a duplicate role mapping', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockUser });
      const conflict = new Error('The conditional request failed');
      conflict.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejects(conflict);

      await expect(repository.ensureUserRoleMapping('u-123', 'CUSTOMER')).resolves.toBe(
        'exists',
      );
    });

    it('scans user meta pages for the role backfill', async () => {
      ddbMock.on(ScanCommand).resolves({
        Items: [{ ...mockUser, PK: 'USER#u-123', SK: 'META', entityType: 'User' }],
      });

      const page = await repository.listUserMetaPage();
      expect(page.users[0]?.userId).toBe('u-123');
      expect(ddbMock.commandCalls(ScanCommand)[0].args[0].input.FilterExpression).toBe(
        'begins_with(PK, :userPrefix) AND SK = :meta',
      );
    });

    it('gets all user role strings', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [{ roleId: 'admin' }] });
      const roles = await repository.getUserRoles('u-123');
      expect(roles).toEqual(['admin']);
    });

    it('gets role metadata', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockRole });
      const role = await repository.getRole('admin');
      expect(role?.name).toBe('Administrator');
    });

    it('lists all roles from catalog', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [mockRole] });
      const roles = await repository.listRoles();
      expect(roles.length).toBe(1);
    });

    it('retrieves role permissions list', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [mockPermission] });
      const perms = await repository.getRolePermissions('admin');
      expect(perms[0]?.permissionId).toBe('write:users');
    });

    it('checks hasPermission', async () => {
      ddbMock.on(GetCommand).resolves({ Item: mockPermission });
      const check = await repository.hasPermission('admin', 'write:users');
      expect(check).toBe(true);
    });

    it('lists permissions', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [mockPermission] });
      const perms = await repository.listPermissions('admin');
      expect(perms.length).toBe(1);
    });
  });

  describe('Audit Methods', () => {
    it('saves and lists login history', async () => {
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(QueryCommand).resolves({ Items: [mockLoginHistory] });

      await repository.saveLoginHistory(mockLoginHistory);
      const list = await repository.listLoginHistory('u-123');
      expect(list.length).toBe(1);
    });

    it('saves and lists audit logs', async () => {
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(QueryCommand).resolves({ Items: [mockAudit] });

      await repository.saveAudit(mockAudit);
      const list = await repository.listAudit('u-123');
      expect(list.length).toBe(1);
    });
  });
});
