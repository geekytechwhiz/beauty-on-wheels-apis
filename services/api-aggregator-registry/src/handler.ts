import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { getMergedSpec, getServiceSpec as fetchServiceSpec } from './aggregator/aggregator.service';
import { clearAggregatorCache } from './aggregator/cache';
import { loadInitialRegistry } from './config/services';
import {
  bootstrapRegistry,
  isRegistryInitialized,
  listServices,
  registerService,
} from './registry/registry.service';

interface JsonBody {
  name?: string;
  url?: string;
  version?: string;
  module?: string;
  rules?: string[];
}

async function ensureBootstrapped(): Promise<void> {
  if (isRegistryInitialized()) return;
  const entries = await loadInitialRegistry();
  bootstrapRegistry(entries);
}

function json(statusCode: number, payload: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify(payload),
  };
}

function parseBody(event: APIGatewayProxyEventV2): JsonBody {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body) as JsonBody;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

export async function health(): Promise<APIGatewayProxyResultV2> {
  await ensureBootstrapped();
  return json(200, {
    status: 'ok',
    service: 'api-aggregator-registry',
    servicesRegistered: listServices().length,
    timestamp: new Date().toISOString(),
  });
}

export async function getServices(): Promise<APIGatewayProxyResultV2> {
  await ensureBootstrapped();
  return json(200, listServices());
}

export async function getSpecs(): Promise<APIGatewayProxyResultV2> {
  await ensureBootstrapped();
  try {
    const merged = await getMergedSpec();
    return json(200, merged);
  } catch (error) {
    console.error('Failed to build merged specs', error);
    return json(500, { message: 'Failed to build merged specs' });
  }
}

export async function getServiceSpecByName(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  await ensureBootstrapped();
  const service = event.pathParameters?.service;
  const version = event.queryStringParameters?.version;
  if (!service) return json(400, { message: 'service path param required' });

  const spec = await fetchServiceSpec(service, version);
  if (!spec) return json(404, { message: 'service/version not found or unreachable' });
  return json(200, spec);
}

export async function postService(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  await ensureBootstrapped();
  try {
    const body = parseBody(event);
    if (!body.name || !body.url) {
      return json(400, { message: 'name and url are required' });
    }
    const updated = registerService({
      name: body.name,
      url: body.url,
      version: body.version || 'v1',
      module: body.module,
      rules: body.rules,
    });
    clearAggregatorCache();
    return json(201, updated);
  } catch (error) {
    return json(400, { message: (error as Error).message });
  }
}

export const getServiceSpec = getServiceSpecByName;
