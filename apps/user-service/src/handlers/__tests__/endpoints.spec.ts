import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

vi.mock('../../services/user.service', () => {
  const assignDoctor = vi.fn();
  const listDoctorPatients = vi.fn();
  return {
    UserService: class {
      assignDoctor = assignDoctor;
      listDoctorPatients = listDoctorPatients;
    },
    __userServiceMocks: { assignDoctor, listDoctorPatients },
  };
});

vi.mock('../../services/friendFamily.service', () => {
  const searchFnf = vi.fn();
  const addMember = vi.fn();
  const updateMember = vi.fn();
  const fetchMembers = vi.fn();
  const deleteMember = vi.fn();
  return {
    FriendFamilyService: class {
      searchFnf = searchFnf;
      addMember = addMember;
      updateMember = updateMember;
      fetchMembers = fetchMembers;
      deleteMember = deleteMember;
    },
    __friendFamilyMocks: { searchFnf, addMember, updateMember, fetchMembers, deleteMember },
  };
});

const mockOk = vi.fn();
const mockBadRequest = vi.fn();
const mockNotFound = vi.fn();
const mockUnauthorized = vi.fn();
const mockUnprocessableEntity = vi.fn();
const mockCreated = vi.fn();
const mockInternalServerError = vi.fn();
vi.mock('@api-hub/utils', () => ({
  ApiResponse: {
    ok: (...args: unknown[]) => mockOk(...args),
    badRequest: (...args: unknown[]) => mockBadRequest(...args),
    notFound: (...args: unknown[]) => mockNotFound(...args),
    unauthorized: (...args: unknown[]) => mockUnauthorized(...args),
    unprocessableEntity: (...args: unknown[]) => mockUnprocessableEntity(...args),
    created: (...args: unknown[]) => mockCreated(...args),
    internalServerError: (...args: unknown[]) => mockInternalServerError(...args),
  },
}));

vi.mock('@api-hub/logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
  createChildLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
  extractCorrelationId: vi.fn(() => 'test-correlation-id'),
  extractAwsRequestId: vi.fn(() => 'test-request-id'),
  serializeError: vi.fn((err: Error) => ({ message: err.message })),
  logHttpRequest: vi.fn(),
}));

import { __userServiceMocks } from '../../services/user.service';
import { __friendFamilyMocks } from '../../services/friendFamily.service';

function createMockEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    httpMethod: 'POST',
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    requestContext: {} as any,
    resource: '',
    stageVariables: null,
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    ...overrides,
  } as APIGatewayProxyEvent;
}

function createMockContext(): Context {
  return {} as Context;
}

describe('assignDoctor', () => {
  beforeAll(async () => {
    await import('../httpHandler');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockOk.mockResolvedValue({ statusCode: 200, body: '{}' });
  });

  it('returns 200 when assignDoctor succeeds', async () => {
    const { assignDoctor } = await import('../httpHandler');
    __userServiceMocks.assignDoctor.mockResolvedValue(undefined);
    const event = createMockEvent({
      body: JSON.stringify({
        organizationId: 'org-1',
        sender: { userId: 'doctor-1', name: 'Dr Smith' },
        receiver: { userId: 'patient-1', name: 'John' },
      }),
    });

    const result = await assignDoctor(event, createMockContext());

    expect(__userServiceMocks.assignDoctor).toHaveBeenCalledWith('org-1', expect.any(Object), expect.any(Object), 'test-correlation-id');
    expect(mockOk).toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
  });

  it('returns 400 when body is invalid JSON', async () => {
    const { assignDoctor } = await import('../httpHandler');
    mockBadRequest.mockResolvedValue({ statusCode: 400, body: '{}' });
    const event = createMockEvent({ body: 'not json' });

    await assignDoctor(event, createMockContext());

    expect(mockBadRequest).toHaveBeenCalled();
    expect(__userServiceMocks.assignDoctor).not.toHaveBeenCalled();
  });

  it('returns 404 when UserNotFoundError', async () => {
    const { assignDoctor } = await import('../httpHandler');
    const { UserNotFoundError } = await import('../../utils/errors');
    __userServiceMocks.assignDoctor.mockRejectedValue(new UserNotFoundError('doctor-1'));
    mockNotFound.mockResolvedValue({ statusCode: 404, body: '{}' });
    const event = createMockEvent({
      body: JSON.stringify({
        organizationId: 'org-1',
        sender: { userId: 'doctor-1', name: 'Dr Smith' },
        receiver: { userId: 'patient-1', name: 'John' },
      }),
    });

    const result = await assignDoctor(event, createMockContext());

    expect(mockNotFound).toHaveBeenCalled();
    expect(result.statusCode).toBe(404);
  });
});

describe('listDoctorPatients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOk.mockResolvedValue({ statusCode: 200, body: '{}' });
    __userServiceMocks.listDoctorPatients.mockResolvedValue([{ userID: 'p1', fullName: 'Patient 1' }]);
  });

  it('returns 200 with users array', async () => {
    const { listDoctorPatients } = await import('../httpHandler');
    const event = createMockEvent({
      body: JSON.stringify({ organizationId: 'org-1', doctorId: 'doctor-1' }),
    });

    const result = await listDoctorPatients(event, createMockContext());

    expect(__userServiceMocks.listDoctorPatients).toHaveBeenCalledWith('doctor-1', 'org-1');
    expect(mockOk).toHaveBeenCalledWith(expect.objectContaining({ users: expect.any(Array) }), expect.any(String), expect.any(Object));
    expect(result.statusCode).toBe(200);
  });

  it('returns 400 when validation fails', async () => {
    const { listDoctorPatients } = await import('../httpHandler');
    mockUnprocessableEntity.mockResolvedValue({ statusCode: 400, body: '{}' });
    const event = createMockEvent({ body: JSON.stringify({}) });

    await listDoctorPatients(event, createMockContext());

    expect(mockUnprocessableEntity).toHaveBeenCalled();
    expect(__userServiceMocks.listDoctorPatients).not.toHaveBeenCalled();
  });
});

describe('friendFamilySearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOk.mockResolvedValue({ statusCode: 200, body: '{}' });
    __friendFamilyMocks.searchFnf.mockResolvedValue({ success: true, invitedUser: 'member-1' });
  });

  it('returns 200 with invitedUser when search finds user', async () => {
    const { friendFamilySearch } = await import('../httpHandler');
    const event = createMockEvent({
      body: JSON.stringify({
        organizationID: 'org-1',
        userID: 'user-1',
        email: 'fnf@example.com',
        fullName: 'FNF User',
        invite: 'email',
        relation: 'FAMILY',
        relationship: 'father',
        emergencyContact: true,
      }),
      requestContext: { authorizer: { userID: 'user-1', organizationID: 'org-1' } } as any,
    });

    const result = await friendFamilySearch(event, createMockContext());

    expect(__friendFamilyMocks.searchFnf).toHaveBeenCalled();
    expect(mockOk).toHaveBeenCalledWith(expect.objectContaining({ invitedUser: 'member-1' }), expect.any(String), expect.any(Object));
    expect(result.statusCode).toBe(200);
  });

  it('returns 401 when userID missing', async () => {
    const { friendFamilySearch } = await import('../httpHandler');
    mockUnauthorized.mockResolvedValue({ statusCode: 401, body: '{}' });
    const event = createMockEvent({
      body: JSON.stringify({
        organizationID: 'org-1',
        email: 'fnf@example.com',
        fullName: 'FNF',
        invite: 'email',
        relation: 'FAMILY',
        emergencyContact: true,
      }),
    });

    await friendFamilySearch(event, createMockContext());

    expect(mockUnauthorized).toHaveBeenCalled();
  });
});

describe('friendFamilyAddMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOk.mockResolvedValue({ statusCode: 200, body: '{}' });
    __friendFamilyMocks.addMember.mockResolvedValue({ userId: 'u1', memberId: 'm1', organizationID: 'org-1', relation: 'FAMILY', relationship: 'father', emergencyContact: true });
  });

  it('returns 200 when add member succeeds', async () => {
    const { friendFamilyAddMember } = await import('../httpHandler');
    const event = createMockEvent({
      body: JSON.stringify({
        organizationID: 'org-1',
        userId: 'user-1',
        memberId: 'member-1',
        userName: 'User One',
        memberName: 'Member One',
        relation: 'FAMILY',
        relationship: 'father',
        emergencyContact: true,
      }),
      requestContext: { authorizer: { userID: 'user-1' } } as any,
    });

    const result = await friendFamilyAddMember(event, createMockContext());

    expect(__friendFamilyMocks.addMember).toHaveBeenCalledWith('org-1', expect.objectContaining({ memberId: 'member-1', userName: 'User One' }), undefined);
    expect(mockOk).toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
  });

  it('returns 404 when UserNotFoundError', async () => {
    const { friendFamilyAddMember } = await import('../httpHandler');
    const { UserNotFoundError } = await import('../../utils/errors');
    __friendFamilyMocks.addMember.mockRejectedValue(new UserNotFoundError('member-1'));
    mockNotFound.mockResolvedValue({ statusCode: 404, body: '{}' });
    const event = createMockEvent({
      body: JSON.stringify({
        organizationID: 'org-1',
        userId: 'user-1',
        memberId: 'member-1',
        userName: 'User',
        memberName: 'Member',
        relation: 'FAMILY',
        relationship: 'father',
        emergencyContact: true,
      }),
    });

    const result = await friendFamilyAddMember(event, createMockContext());

    expect(mockNotFound).toHaveBeenCalled();
    expect(result.statusCode).toBe(404);
  });
});

describe('friendFamilyUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOk.mockResolvedValue({ statusCode: 200, body: '{}' });
    __friendFamilyMocks.updateMember.mockResolvedValue(undefined);
  });

  it('returns 200 when update succeeds', async () => {
    const { friendFamilyUpdate } = await import('../httpHandler');
    const event = createMockEvent({
      body: JSON.stringify({
        organizationID: 'org-1',
        memberId: 'member-1',
        fullName: 'Updated Name',
        relation: 'FAMILY',
        relationship: 'spouse',
        emergencyContact: false,
      }),
      requestContext: { authorizer: { userID: 'user-1' } } as any,
    });

    const result = await friendFamilyUpdate(event, createMockContext());

    expect(__friendFamilyMocks.updateMember).toHaveBeenCalledWith('user-1', 'org-1', expect.objectContaining({ memberId: 'member-1', fullName: 'Updated Name' }));
    expect(mockOk).toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
  });

  it('returns 400 when MEMBER_NOT_FOUND', async () => {
    const { friendFamilyUpdate } = await import('../httpHandler');
    __friendFamilyMocks.updateMember.mockRejectedValue(new Error('MEMBER_NOT_FOUND'));
    mockBadRequest.mockResolvedValue({ statusCode: 400, body: '{}' });
    const event = createMockEvent({
      body: JSON.stringify({ organizationID: 'org-1', memberId: 'member-1' }),
      requestContext: { authorizer: { userID: 'user-1' } } as any,
    });

    const result = await friendFamilyUpdate(event, createMockContext());

    expect(mockBadRequest).toHaveBeenCalledWith('FRIEND_FAMILY.MEMBER_NOT_FOUND', expect.any(Object), expect.any(Object));
    expect(result.statusCode).toBe(400);
  });
});

describe('friendFamilyFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOk.mockResolvedValue({ statusCode: 200, body: '{}' });
    __friendFamilyMocks.fetchMembers.mockResolvedValue({ invitee: [], inviter: [] });
  });

  it('returns 200 with invitee and inviter', async () => {
    const { friendFamilyFetch } = await import('../httpHandler');
    const event = createMockEvent({
      body: JSON.stringify({ userId: 'user-1' }),
      requestContext: { authorizer: { userID: 'user-1' } } as any,
    });

    const result = await friendFamilyFetch(event, createMockContext());

    expect(__friendFamilyMocks.fetchMembers).toHaveBeenCalledWith('user-1');
    expect(mockOk).toHaveBeenCalledWith(expect.objectContaining({ invitee: [], inviter: [] }), 'FRIEND_FAMILY.FETCH_SUCCESS', expect.any(Object));
    expect(result.statusCode).toBe(200);
  });

  it('returns 400 when userId missing', async () => {
    const { friendFamilyFetch } = await import('../httpHandler');
    mockBadRequest.mockResolvedValue({ statusCode: 400, body: '{}' });
    const event = createMockEvent({ body: JSON.stringify({}) });

    await friendFamilyFetch(event, createMockContext());

    expect(mockBadRequest).toHaveBeenCalled();
    expect(__friendFamilyMocks.fetchMembers).not.toHaveBeenCalled();
  });
});

describe('friendFamilyDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreated.mockResolvedValue({ statusCode: 201, body: '{}' });
    __friendFamilyMocks.deleteMember.mockResolvedValue(undefined);
  });

  it('returns 201 when delete succeeds', async () => {
    const { friendFamilyDelete } = await import('../httpHandler');
    const event = createMockEvent({
      body: JSON.stringify({ userID: 'user-1', memberID: 'member-1', organizationID: 'org-1' }),
    });

    const result = await friendFamilyDelete(event, createMockContext());

    expect(__friendFamilyMocks.deleteMember).toHaveBeenCalledWith('user-1', 'member-1', 'org-1');
    expect(mockCreated).toHaveBeenCalledWith(expect.objectContaining({ userID: 'user-1', memberID: 'member-1' }), 'FRIEND_FAMILY.DELETE_SUCCESS', expect.any(Object));
    expect(result.statusCode).toBe(201);
  });

  it('returns 400 when FNF_DOES_NOT_EXIST', async () => {
    const { friendFamilyDelete } = await import('../httpHandler');
    __friendFamilyMocks.deleteMember.mockRejectedValue(new Error('FNF_DOES_NOT_EXIST'));
    mockBadRequest.mockResolvedValue({ statusCode: 400, body: '{}' });
    const event = createMockEvent({
      body: JSON.stringify({ userID: 'user-1', memberID: 'member-1' }),
    });

    const result = await friendFamilyDelete(event, createMockContext());

    expect(mockBadRequest).toHaveBeenCalledWith('FRIEND_FAMILY.FNF_DOES_NOT_EXIST', expect.any(Object), expect.any(Object));
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when validation fails', async () => {
    const { friendFamilyDelete } = await import('../httpHandler');
    mockUnprocessableEntity.mockResolvedValue({ statusCode: 400, body: '{}' });
    const event = createMockEvent({ body: JSON.stringify({}) });

    await friendFamilyDelete(event, createMockContext());

    expect(mockUnprocessableEntity).toHaveBeenCalled();
    expect(__friendFamilyMocks.deleteMember).not.toHaveBeenCalled();
  });
});
