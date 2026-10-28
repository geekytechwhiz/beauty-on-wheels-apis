import { APIGatewayProxyEvent, Context } from 'aws-lambda';

jest.mock('../repositories/vehicles.repository', () => {
  const repo = {
    listVehicles: jest.fn().mockResolvedValue([]),
    createVehicle: jest.fn().mockResolvedValue(undefined),
  };
  return {
    getVehiclesRepository: () => repo,
    VehiclesRepository: class VehiclesRepository {},
    __repo: repo,
  };
});

import { handlePostvehicles } from './vehicles-handler';

const repo = (
  jest.requireMock('../repositories/vehicles.repository') as {
    __repo: {
      listVehicles: jest.Mock;
      createVehicle: jest.Mock;
    };
  }
).__repo;

const EXPO_ORIGIN = 'http://localhost:8081';

function event(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/vehicles',
    resource: '/vehicles',
    headers: {
      Origin: EXPO_ORIGIN,
      Authorization: 'Bearer expo-web-token',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'expo-web-vehicle-1',
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'expo-web-request',
      authorizer: {
        identityId: 'user-1',
        userId: 'user-1',
        roles: '',
        permissions: '',
      },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    body: JSON.stringify({
      registrationNumber: 'KL07AB1234',
      vehicleType: 'HATCHBACK',
    }),
    isBase64Encoded: false,
    ...overrides,
  };
}

describe('POST /vehicles from Expo Web', () => {
  const originalCors = process.env.CORS_ALLOWED_ORIGINS;

  beforeEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    repo.listVehicles.mockReset();
    repo.listVehicles.mockResolvedValue([]);
    repo.createVehicle.mockReset();
    repo.createVehicle.mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (originalCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = originalCors;
  });

  it('creates a vehicle and returns a single Expo origin', async () => {
    const response = await handlePostvehicles(event(), {} as Context);
    expect(response.statusCode).toBe(200);
    expect(repo.createVehicle).toHaveBeenCalledTimes(1);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.registrationNumber).toBe('KL07AB1234');
    expect(body.data.vehicleType).toBe('HATCHBACK');
    expect(response.headers?.['Access-Control-Allow-Origin']).toBe(EXPO_ORIGIN);
    expect(response.headers?.['Access-Control-Allow-Credentials']).toBe('true');
    expect(response.headers?.['Access-Control-Allow-Headers']).toContain('Authorization');
    expect(response.headers?.['Access-Control-Allow-Headers']).toContain('Content-Type');
    expect(response.headers?.['Access-Control-Allow-Headers']).toContain('Idempotency-Key');
    expect(
      Object.entries(response.headers ?? {}).filter(([key]) => key.toLowerCase() === 'access-control-allow-origin'),
    ).toHaveLength(1);
  });

  it('returns validation errors with CORS headers and does not require the authorizer for OPTIONS', async () => {
    const invalid = await handlePostvehicles(
      event({ body: JSON.stringify({ vehicleType: 'HATCHBACK' }) }),
      {} as Context,
    );
    expect(invalid.statusCode).toBe(400);
    expect(invalid.headers?.['Access-Control-Allow-Origin']).toBe(EXPO_ORIGIN);
    expect(repo.createVehicle).not.toHaveBeenCalled();

    const preflight = await handlePostvehicles(
      event({
        httpMethod: 'OPTIONS',
        body: null,
        requestContext: { requestId: 'preflight' } as APIGatewayProxyEvent['requestContext'],
      }),
      {} as Context,
    );
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers?.['Access-Control-Allow-Origin']).toBe(EXPO_ORIGIN);
    expect(preflight.headers?.['Access-Control-Allow-Headers']).toContain('Idempotency-Key');
    expect(repo.createVehicle).not.toHaveBeenCalled();
    expect(repo.listVehicles).not.toHaveBeenCalled();
  });
});
