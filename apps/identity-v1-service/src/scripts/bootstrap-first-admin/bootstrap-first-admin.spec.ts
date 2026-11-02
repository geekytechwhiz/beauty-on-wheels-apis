import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

import {
  assertReadyForAdminCommit,
  buildAdminRoleMappingItem,
  buildCommitTransactItems,
  BOOTSTRAP_CONFIRM_PHRASE,
  BOOTSTRAP_KEYS,
  BootstrapError,
  compensateBootstrapRun,
  createInitialJournal,
  meetsDestinationVerificationPolicy,
  parseBootstrapArgs,
  runFirstAdminBootstrap,
  sanitizeForLog,
  SAGA_STATE,
  sendOtpChallenge,
  verifyOtpChallenge,
} from './index';
import type { BootstrapCliArgs, BootstrapJournal } from './types';

type Item = Record<string, unknown>;

function itemKey(item: { PK?: unknown; SK?: unknown }): string {
  return `${String(item.PK)}|${String(item.SK)}`;
}

function createMemoryDb(seed: Item[] = []) {
  const store = new Map<string, Item>();
  for (const item of seed) {
    store.set(itemKey(item), { ...item });
  }

  const db = {
    send: jest.fn(async (command: unknown) => {
      if (command instanceof GetCommand) {
        const key = itemKey(command.input.Key as Item);
        return { Item: store.get(key) };
      }
      if (command instanceof PutCommand) {
        const item = command.input.Item as Item;
        const key = itemKey(item);
        const condition = command.input.ConditionExpression ?? '';
        if (
          condition.includes('attribute_not_exists(PK)') &&
          !condition.includes('OR') &&
          store.has(key)
        ) {
          const err = new Error('ConditionalCheckFailed');
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }
        if (
          condition.includes('attribute_not_exists(PK)') &&
          condition.includes('OR') &&
          store.has(key)
        ) {
          const existing = store.get(key)!;
          const expected = (
            command.input.ExpressionAttributeValues as Record<string, unknown>
          )?.[':expectedVersion'];
          if (existing.version !== expected) {
            const err = new Error('ConditionalCheckFailed');
            err.name = 'ConditionalCheckFailedException';
            throw err;
          }
        }
        if (condition.includes('expiresAt < :now') && store.has(key)) {
          const existing = store.get(key)!;
          const values =
            (command.input.ExpressionAttributeValues as Record<
              string,
              unknown
            >) ?? {};
          const now = values[':now'];
          const runId = values[':runId'];
          const sameRun = runId !== undefined && existing.runId === runId;
          const expired =
            typeof existing.expiresAt === 'string' &&
            typeof now === 'string' &&
            existing.expiresAt < now;
          if (!sameRun && !expired) {
            const err = new Error('ConditionalCheckFailed');
            err.name = 'ConditionalCheckFailedException';
            throw err;
          }
        }
        if (
          condition === 'version = :expectedVersion' &&
          store.has(key)
        ) {
          const existing = store.get(key)!;
          const expected = (
            command.input.ExpressionAttributeValues as Record<string, unknown>
          )?.[':expectedVersion'];
          if (existing.version !== expected) {
            const err = new Error('ConditionalCheckFailed');
            err.name = 'ConditionalCheckFailedException';
            throw err;
          }
        }
        if (
          condition === 'version = :expectedVersion' &&
          !store.has(key)
        ) {
          const err = new Error('ConditionalCheckFailed');
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }
        store.set(key, { ...item });
        return {};
      }
      if (command instanceof DeleteCommand) {
        const key = itemKey(command.input.Key as Item);
        const condition = command.input.ConditionExpression ?? '';
        if (condition.includes('runId = :runId')) {
          const existing = store.get(key);
          const expected = (
            command.input.ExpressionAttributeValues as Record<string, unknown>
          )?.[':runId'];
          if (!existing || existing.runId !== expected) {
            const err = new Error('ConditionalCheckFailed');
            err.name = 'ConditionalCheckFailedException';
            throw err;
          }
        }
        store.delete(key);
        return {};
      }
      if (command instanceof QueryCommand) {
        const pk = (
          command.input.ExpressionAttributeValues as Record<string, unknown>
        )?.[':pk'];
        const prefix = (
          command.input.ExpressionAttributeValues as Record<string, unknown>
        )?.[':prefix'];
        const items = [...store.values()].filter(
          (item) =>
            item.PK === pk &&
            typeof item.SK === 'string' &&
            typeof prefix === 'string' &&
            item.SK.startsWith(prefix),
        );
        return { Items: items };
      }
      if (command instanceof ScanCommand) {
        const items = [...store.values()].filter(
          (item) => item.entityType === 'UserRole' && item.roleId === 'ADMIN',
        );
        return { Count: items.length, Items: items };
      }
      if (command instanceof TransactWriteCommand) {
        const items = command.input.TransactItems ?? [];
        for (const entry of items) {
          const put = entry.Put;
          if (!put?.Item) continue;
          const key = itemKey(put.Item as Item);
          if (
            put.ConditionExpression?.includes('attribute_not_exists(PK)') &&
            store.has(key)
          ) {
            const err = new Error('Transaction canceled');
            err.name = 'TransactionCanceledException';
            throw err;
          }
        }
        for (const entry of items) {
          if (entry.Put?.Item) {
            store.set(itemKey(entry.Put.Item as Item), {
              ...(entry.Put.Item as Item),
            });
          }
        }
        return {};
      }
      throw new Error(`Unhandled command ${command?.constructor?.name}`);
    }),
  };

  return { db: db as never, store };
}

function baseArgs(overrides: Partial<BootstrapCliArgs> = {}): BootstrapCliArgs {
  return {
    stage: 'dev',
    table: 'identity-table-dev',
    apiBaseUrl: 'https://identity.example/dev',
    destination: 'admin@example.com',
    approvedBy: 'alice',
    executedBy: 'bob',
    changeTicket: 'CHG-1',
    expectedAccountId: '111122223333',
    userType: 'CUSTOMER',
    apply: false,
    confirmProduction: false,
    allowUnverified: false,
    ...overrides,
  };
}

function seedHappyPath(store: Map<string, Item>, userId = 'u-1') {
  store.set(`USER#${userId}|META`, {
    PK: `USER#${userId}`,
    SK: 'META',
    userId,
    status: 'ACTIVE',
    emailVerified: true,
    phoneVerified: false,
    roleId: 'user',
  });
  store.set(`EMAIL#admin@example.com|LOOKUP`, {
    PK: 'EMAIL#admin@example.com',
    SK: 'LOOKUP',
    userId,
  });
  store.set('ROLE#ADMIN|METADATA', {
    PK: 'ROLE#ADMIN',
    SK: 'METADATA',
    roleId: 'ADMIN',
  });
}

describe('first-admin bootstrap args', () => {
  it('defaults to dry-run and rejects ADMIN userType', () => {
    const parsed = parseBootstrapArgs([
      '--stage',
      'dev',
      '--table',
      'identity-table-dev',
      '--api-base-url',
      'https://example.com',
      '--destination',
      'a@b.com',
      '--approved-by',
      'alice',
      '--executed-by',
      'bob',
      '--change-ticket',
      'CHG-1',
      '--expected-account-id',
      '123',
    ]);
    expect(parsed.apply).toBe(false);
    expect(() =>
      parseBootstrapArgs([
        '--stage',
        'dev',
        '--table',
        'identity-table-dev',
        '--api-base-url',
        'https://example.com',
        '--destination',
        'a@b.com',
        '--approved-by',
        'alice',
        '--executed-by',
        'bob',
        '--change-ticket',
        'CHG-1',
        '--expected-account-id',
        '123',
        '--user-type',
        'ADMIN',
      ]),
    ).toThrow(/CUSTOMER or VENDOR/);
  });

  it('refuses production without confirm-production', () => {
    expect(() =>
      parseBootstrapArgs([
        '--stage',
        'prod',
        '--table',
        'identity-table-prod',
        '--api-base-url',
        'https://example.com',
        '--destination',
        'a@b.com',
        '--approved-by',
        'alice',
        '--executed-by',
        'bob',
        '--change-ticket',
        'CHG-1',
        '--expected-account-id',
        '123',
      ]),
    ).toThrow(/confirm-production/);
  });

  it('requires confirm phrase for apply', () => {
    expect(() =>
      parseBootstrapArgs([
        '--stage',
        'dev',
        '--table',
        'identity-table-dev',
        '--api-base-url',
        'https://example.com',
        '--destination',
        'a@b.com',
        '--approved-by',
        'alice',
        '--executed-by',
        'bob',
        '--change-ticket',
        'CHG-1',
        '--expected-account-id',
        '123',
        '--apply',
      ]),
    ).toThrow(BOOTSTRAP_CONFIRM_PHRASE);
  });
});

describe('sanitizeForLog', () => {
  it('redacts OTP and tokens', () => {
    const sanitized = sanitizeForLog({
      otp: '123456',
      accessToken: 'eyJhbGciOiJIUzI1NiJ9.aaa.bbb',
      nested: { refreshToken: 'secret', userId: 'u-1' },
    }) as Record<string, unknown>;
    expect(sanitized.otp).toBe('[redacted]');
    expect(sanitized.accessToken).toBe('[redacted]');
    expect((sanitized.nested as Record<string, unknown>).refreshToken).toBe(
      '[redacted]',
    );
    expect((sanitized.nested as Record<string, unknown>).userId).toBe('u-1');
    expect(JSON.stringify(sanitized)).not.toContain('123456');
    expect(JSON.stringify(sanitized)).not.toContain('eyJ');
  });
});

describe('verification policy', () => {
  it('requires verified destination channel in production', () => {
    expect(
      meetsDestinationVerificationPolicy({
        stage: 'prod',
        destinationKind: 'email',
        emailVerified: false,
        phoneVerified: true,
        allowUnverified: false,
      }),
    ).toBe(false);
    expect(
      meetsDestinationVerificationPolicy({
        stage: 'dev',
        destinationKind: 'email',
        emailVerified: false,
        phoneVerified: true,
        allowUnverified: false,
      }),
    ).toBe(true);
  });
});

describe('commit contract', () => {
  it('matches ensureUserRoleMapping storage shape and omits profile roleId updates', () => {
    const item = buildAdminRoleMappingItem({
      userId: 'u-1',
      now: '2020-01-01T00:00:00.000Z',
    });
    expect(item).toEqual({
      PK: 'USER#u-1',
      SK: 'ROLE#ADMIN',
      entityType: 'UserRole',
      userId: 'u-1',
      roleId: 'ADMIN',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    });
    const tx = buildCommitTransactItems({
      userId: 'u-1',
      stage: 'dev',
      tableName: 'identity-table-dev',
      approvedBy: 'alice',
      executedBy: 'bob',
      changeTicket: 'CHG-1',
      now: '2020-01-01T00:00:00.000Z',
      auditId: 'audit-1',
      runId: 'run-1',
    });
    expect(tx).toHaveLength(3);
    expect(JSON.stringify(tx)).not.toContain('"roleId":"user"');
    expect(tx[0].Put?.Item?.SK).toBe('ROLE#ADMIN');
    expect(tx[1].Put?.Item?.PK).toBe(BOOTSTRAP_KEYS.marker.PK);
  });

  it('rejects missing/inactive user, missing role metadata, and existing admin', () => {
    expect(() =>
      assertReadyForAdminCommit({
        user: null,
        role: { roleId: 'ADMIN' },
        bootstrapMarker: null,
        adminMappingCount: 0,
        existingRoles: [],
      }),
    ).toThrow(/not found/i);

    expect(() =>
      assertReadyForAdminCommit({
        user: { status: 'suspended' },
        role: { roleId: 'ADMIN' },
        bootstrapMarker: null,
        adminMappingCount: 0,
        existingRoles: [],
      }),
    ).toThrow(/not active/i);

    expect(() =>
      assertReadyForAdminCommit({
        user: { status: 'active' },
        role: null,
        bootstrapMarker: null,
        adminMappingCount: 0,
        existingRoles: [],
      }),
    ).toThrow(/ADMIN role metadata/i);

    expect(() =>
      assertReadyForAdminCommit({
        user: { status: 'active' },
        role: { roleId: 'ADMIN' },
        bootstrapMarker: { PK: 'SYSTEM#FIRST_ADMIN_BOOTSTRAP' },
        adminMappingCount: 0,
        existingRoles: [],
      }),
    ).toThrow(/already exists/i);

    expect(() =>
      assertReadyForAdminCommit({
        user: { status: 'active' },
        role: { roleId: 'ADMIN' },
        bootstrapMarker: null,
        adminMappingCount: 1,
        existingRoles: [],
      }),
    ).toThrow(/ADMIN role mapping already exists/i);
  });
});

describe('OTP client', () => {
  it('fails OTP verify without exposing tokens from the response body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        message: 'Invalid or expired OTP',
        accessToken: 'should-not-leak',
        refreshToken: 'should-not-leak',
      }),
    });
    await expect(
      verifyOtpChallenge({
        apiBaseUrl: 'https://example.com',
        destination: 'a@b.com',
        otp: '123456',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: 'OTP_VERIFY_FAILED' });

    try {
      await verifyOtpChallenge({
        apiBaseUrl: 'https://example.com',
        destination: 'a@b.com',
        otp: '123456',
        fetchImpl: fetchImpl as never,
      });
    } catch (error) {
      const text = JSON.stringify(error);
      expect(text).not.toContain('should-not-leak');
      expect(text).not.toContain('123456');
    }
  });

  it('returns only referenceId from send', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, referenceId: 'ref-1' }),
    });
    await expect(
      sendOtpChallenge({
        apiBaseUrl: 'https://example.com',
        destination: 'a@b.com',
        userType: 'CUSTOMER',
        fetchImpl: fetchImpl as never,
      }),
    ).resolves.toEqual({ success: true, referenceId: 'ref-1' });
  });
});

describe('runFirstAdminBootstrap saga', () => {
  const sts = {
    send: jest.fn().mockResolvedValue({ Account: '111122223333' }),
  };
  const dynamo = {
    send: jest.fn().mockResolvedValue({ Table: { TableStatus: 'ACTIVE' } }),
  };

  function fetchMock(otpOk = true) {
    return jest.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/health')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (String(url).endsWith('/otp/send')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, referenceId: 'ref-1' }),
        };
      }
      if (String(url).endsWith('/otp/verify')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          otp?: string;
        };
        expect(body.otp).toBeDefined();
        if (!otpOk) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              message: 'Invalid',
              accessToken: 'nope',
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: 'must-be-discarded',
            refreshToken: 'must-be-discarded',
            expiresIn: 3600,
            tokenType: 'Bearer',
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
  }

  it('dry-run validates and does not write ADMIN mapping', async () => {
    const { db, store } = createMemoryDb();
    seedHappyPath(store);

    const logs: unknown[] = [];
    const result = await runFirstAdminBootstrap({
      args: baseArgs({ otp: '999999' }),
      region: 'us-east-1',
      sts: sts as never,
      dynamo: dynamo as never,
      db,
      fetchImpl: fetchMock() as never,
      promptOtp: async () => '999999',
      createRunId: () => 'run-dry',
      log: (payload) => logs.push(payload),
    });

    expect(result.mode).toBe('dry-run');
    expect(result.userId).toBe('u-1');
    expect(store.has('USER#u-1|ROLE#ADMIN')).toBe(false);
    expect(store.has(itemKey(BOOTSTRAP_KEYS.marker))).toBe(false);
    expect(JSON.stringify(logs)).not.toContain('must-be-discarded');
    expect(JSON.stringify(logs)).not.toContain('999999');
  });

  it('successful apply writes ADMIN mapping, marker, and audit atomically', async () => {
    const { db, store } = createMemoryDb();
    seedHappyPath(store);

    const result = await runFirstAdminBootstrap({
      args: baseArgs({
        apply: true,
        confirm: BOOTSTRAP_CONFIRM_PHRASE,
        otp: '999999',
      }),
      region: 'us-east-1',
      sts: sts as never,
      dynamo: dynamo as never,
      db,
      fetchImpl: fetchMock() as never,
      promptOtp: async () => '999999',
      createRunId: () => 'run-ok',
      log: () => undefined,
    });

    expect(result.state).toBe(SAGA_STATE.COMPLETED);
    expect(store.get('USER#u-1|ROLE#ADMIN')).toMatchObject({
      entityType: 'UserRole',
      roleId: 'ADMIN',
      userId: 'u-1',
    });
    expect(store.get(itemKey(BOOTSTRAP_KEYS.marker))).toMatchObject({
      entityType: 'AdminBootstrap',
      targetUserId: 'u-1',
      runId: 'run-ok',
    });
    // Legacy profile roleId must remain untouched.
    expect(store.get('USER#u-1|META')?.roleId).toBe('user');
  });

  it('fails on OTP verify without committing ADMIN', async () => {
    const { db, store } = createMemoryDb();
    seedHappyPath(store);

    await expect(
      runFirstAdminBootstrap({
        args: baseArgs({
          apply: true,
          confirm: BOOTSTRAP_CONFIRM_PHRASE,
          otp: 'bad',
        }),
        region: 'us-east-1',
        sts: sts as never,
        dynamo: dynamo as never,
        db,
        fetchImpl: fetchMock(false) as never,
        promptOtp: async () => 'bad',
        createRunId: () => 'run-otp-fail',
        log: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'OTP_VERIFY_FAILED' });

    expect(store.has('USER#u-1|ROLE#ADMIN')).toBe(false);
  });

  it('reuses existing identity without marking createdIdentityAccount', async () => {
    const { db, store } = createMemoryDb();
    seedHappyPath(store);

    const result = await runFirstAdminBootstrap({
      args: baseArgs({
        apply: true,
        confirm: BOOTSTRAP_CONFIRM_PHRASE,
        otp: '999999',
      }),
      region: 'us-east-1',
      sts: sts as never,
      dynamo: dynamo as never,
      db,
      fetchImpl: fetchMock() as never,
      promptOtp: async () => '999999',
      createRunId: () => 'run-reuse',
      log: () => undefined,
      cognito: {
        userExists: async () => true,
        deleteUser: async () => undefined,
        probeExists: async () => true,
      },
    });

    expect(result.state).toBe(SAGA_STATE.COMPLETED);
    const journal = [...store.values()].find(
      (item) => item.entityType === 'AdminBootstrapJournal',
    ) as BootstrapJournal;
    expect(journal.ownership.identityExistedBeforeRun).toBe(true);
    expect(journal.ownership.createdIdentityAccount).toBe(false);
    expect(journal.ownership.createdCognitoUser).toBe(false);
  });

  it('fails when identity META is missing after OTP', async () => {
    const { db, store } = createMemoryDb();
    store.set('ROLE#ADMIN|METADATA', {
      PK: 'ROLE#ADMIN',
      SK: 'METADATA',
      roleId: 'ADMIN',
    });

    await expect(
      runFirstAdminBootstrap({
        args: baseArgs({
          apply: true,
          confirm: BOOTSTRAP_CONFIRM_PHRASE,
          otp: '999999',
        }),
        region: 'us-east-1',
        sts: sts as never,
        dynamo: dynamo as never,
        db,
        fetchImpl: fetchMock() as never,
        promptOtp: async () => '999999',
        createRunId: () => 'run-missing',
        log: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_NOT_FOUND' });
  });

  it('fails when identity is inactive', async () => {
    const { db, store } = createMemoryDb();
    seedHappyPath(store);
    store.set('USER#u-1|META', {
      ...store.get('USER#u-1|META'),
      status: 'suspended',
    });

    await expect(
      runFirstAdminBootstrap({
        args: baseArgs({
          apply: true,
          confirm: BOOTSTRAP_CONFIRM_PHRASE,
          otp: '999999',
        }),
        region: 'us-east-1',
        sts: sts as never,
        dynamo: dynamo as never,
        db,
        fetchImpl: fetchMock() as never,
        promptOtp: async () => '999999',
        createRunId: () => 'run-inactive',
        log: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_INACTIVE' });
  });

  it('fails when ADMIN role metadata is missing', async () => {
    const { db, store } = createMemoryDb();
    seedHappyPath(store);
    store.delete('ROLE#ADMIN|METADATA');

    await expect(
      runFirstAdminBootstrap({
        args: baseArgs({
          apply: true,
          confirm: BOOTSTRAP_CONFIRM_PHRASE,
          otp: '999999',
        }),
        region: 'us-east-1',
        sts: sts as never,
        dynamo: dynamo as never,
        db,
        fetchImpl: fetchMock() as never,
        promptOtp: async () => '999999',
        createRunId: () => 'run-role-meta',
        log: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_ROLE_METADATA_MISSING' });
  });

  it('fails when an ADMIN mapping already exists', async () => {
    const { db, store } = createMemoryDb();
    seedHappyPath(store);
    store.set('USER#other|ROLE#ADMIN', {
      PK: 'USER#other',
      SK: 'ROLE#ADMIN',
      entityType: 'UserRole',
      roleId: 'ADMIN',
    });

    await expect(
      runFirstAdminBootstrap({
        args: baseArgs({
          apply: true,
          confirm: BOOTSTRAP_CONFIRM_PHRASE,
          otp: '999999',
        }),
        region: 'us-east-1',
        sts: sts as never,
        dynamo: dynamo as never,
        db,
        fetchImpl: fetchMock() as never,
        promptOtp: async () => '999999',
        createRunId: () => 'run-existing-admin',
        log: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_ALREADY_EXISTS' });
  });

  it('prevents concurrent bootstrap via lock', async () => {
    const { db, store } = createMemoryDb();
    seedHappyPath(store);
    store.set(itemKey(BOOTSTRAP_KEYS.lock), {
      ...BOOTSTRAP_KEYS.lock,
      runId: 'other-run',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    await expect(
      runFirstAdminBootstrap({
        args: baseArgs({
          apply: true,
          confirm: BOOTSTRAP_CONFIRM_PHRASE,
          otp: '999999',
        }),
        region: 'us-east-1',
        sts: sts as never,
        dynamo: dynamo as never,
        db,
        fetchImpl: fetchMock() as never,
        promptOtp: async () => '999999',
        createRunId: () => 'run-lock',
        now: () => new Date('2020-01-01T00:00:00.000Z'),
        log: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_LOCK_HELD' });
  });

  it('surfaces DynamoDB transaction failure as recoverable', async () => {
    const { db, store } = createMemoryDb();
    seedHappyPath(store);
    const originalSend = db.send;
    db.send = jest.fn(async (command: unknown) => {
      if (command instanceof TransactWriteCommand) {
        const err = new Error('boom');
        err.name = 'TransactionCanceledException';
        throw err;
      }
      return originalSend(command);
    }) as never;

    await expect(
      runFirstAdminBootstrap({
        args: baseArgs({
          apply: true,
          confirm: BOOTSTRAP_CONFIRM_PHRASE,
          otp: '999999',
        }),
        region: 'us-east-1',
        sts: sts as never,
        dynamo: dynamo as never,
        db,
        fetchImpl: fetchMock() as never,
        promptOtp: async () => '999999',
        createRunId: () => 'run-tx-fail',
        log: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: 'DYNAMODB_TRANSACTION_FAILED',
      recoverable: true,
    });
    expect(store.has('USER#u-1|ROLE#ADMIN')).toBe(false);
  });

  it('fails preflight on Cognito/API unreachable base URL', async () => {
    const { db } = createMemoryDb();
    await expect(
      runFirstAdminBootstrap({
        args: baseArgs(),
        region: 'us-east-1',
        sts: sts as never,
        dynamo: dynamo as never,
        db,
        fetchImpl: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never,
        promptOtp: async () => '1',
        createRunId: () => 'run-api',
        log: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'API_UNREACHABLE' });
  });

  it('safe compensation does not delete reused identity', async () => {
    const { db, store } = createMemoryDb();
    seedHappyPath(store);
    const journal = createInitialJournal({
      runId: 'run-comp',
      stage: 'dev',
      tableName: 'identity-table-dev',
      region: 'us-east-1',
      accountId: '111122223333',
      apiBaseUrl: 'https://example.com',
      destinationKind: 'email',
      destinationFingerprint: 'x',
      approvedBy: 'alice',
      executedBy: 'bob',
      changeTicket: 'CHG-1',
      mode: 'apply',
      nowIso: '2020-01-01T00:00:00.000Z',
    });
    journal.userId = 'u-1';
    journal.ownership.identityExistedBeforeRun = true;
    journal.ownership.createdIdentityAccount = false;
    journal.ownership.cognitoExistedBeforeRun = true;
    journal.adminMappingWritten = false;

    const result = await compensateBootstrapRun({
      db,
      tableName: 'identity-table-dev',
      journal,
      nowIso: '2020-01-01T00:00:00.000Z',
    });
    expect(result.state).toBe(SAGA_STATE.COMPENSATED);
    expect(store.has('USER#u-1|META')).toBe(true);
  });

  it('stops in recoverable state when downstream provisioning is observed', async () => {
    const { db, store } = createMemoryDb();
    seedHappyPath(store);
    store.set('USER#u-1|PROFILE', {
      PK: 'USER#u-1',
      SK: 'PROFILE',
      userProvisioning: { status: 'PENDING' },
    });
    const journal = createInitialJournal({
      runId: 'run-down',
      stage: 'dev',
      tableName: 'identity-table-dev',
      region: 'us-east-1',
      accountId: '111122223333',
      apiBaseUrl: 'https://example.com',
      destinationKind: 'email',
      destinationFingerprint: 'x',
      approvedBy: 'alice',
      executedBy: 'bob',
      changeTicket: 'CHG-1',
      mode: 'apply',
      nowIso: '2020-01-01T00:00:00.000Z',
    });
    journal.userId = 'u-1';
    journal.ownership.createdIdentityAccount = true;

    const result = await compensateBootstrapRun({
      db,
      tableName: 'identity-table-dev',
      journal,
      nowIso: '2020-01-01T00:00:00.000Z',
    });
    expect(result.state).toBe(SAGA_STATE.NEEDS_MANUAL_RECOVERY);
    expect(result.recoveryHint).toMatch(/Downstream/i);
    expect(store.has('USER#u-1|META')).toBe(true);
  });

  it('resumes a validated journal and commits ADMIN', async () => {
    const { db, store } = createMemoryDb();
    seedHappyPath(store);
    const journal = createInitialJournal({
      runId: 'run-resume',
      stage: 'dev',
      tableName: 'identity-table-dev',
      region: 'us-east-1',
      accountId: '111122223333',
      apiBaseUrl: 'https://identity.example/dev',
      destinationKind: 'email',
      destinationFingerprint: 'x',
      approvedBy: 'alice',
      executedBy: 'bob',
      changeTicket: 'CHG-1',
      mode: 'apply',
      nowIso: '2020-01-01T00:00:00.000Z',
    });
    journal.state = SAGA_STATE.VALIDATED;
    journal.userId = 'u-1';
    journal.referenceId = 'ref-1';
    journal.ownership.identityExistedBeforeRun = true;
    store.set(`${journal.PK}|${journal.SK}`, journal as unknown as Item);

    const result = await runFirstAdminBootstrap({
      args: baseArgs({
        apply: true,
        confirm: BOOTSTRAP_CONFIRM_PHRASE,
        resumeRunId: 'run-resume',
      }),
      region: 'us-east-1',
      sts: sts as never,
      dynamo: dynamo as never,
      db,
      fetchImpl: fetchMock() as never,
      promptOtp: async () => {
        throw new Error('OTP should not be prompted on validated resume');
      },
      log: () => undefined,
    });

    expect(result.state).toBe(SAGA_STATE.COMPLETED);
    expect(store.get('USER#u-1|ROLE#ADMIN')?.roleId).toBe('ADMIN');
  });
});

describe('BootstrapError', () => {
  it('is an Error with code', () => {
    const err = new BootstrapError('x', 'Y', { recoverable: true });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('Y');
    expect(err.recoverable).toBe(true);
  });
});
