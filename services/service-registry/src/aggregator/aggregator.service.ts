import axios from 'axios';
import {
  getIndividualSpecFromCache,
  getMergedSpecFromCache,
  setIndividualSpecCache,
  setMergedSpecCache,
} from './cache';
import { mergeSpecs, type MergeInputSpec, type OpenApiObject } from './merge.util';
import { listServices, resolveServiceUrl } from '../registry/registry.service';

async function fetchSpec(url: string): Promise<OpenApiObject> {
  const response = await axios.get(url, {
    timeout: 15_000,
    validateStatus: (status) => status >= 200 && status < 300,
    headers: { Accept: 'application/json' },
  });
  return response.data as OpenApiObject;
}

export async function getServiceSpec(
  serviceName: string,
  version?: string,
): Promise<OpenApiObject | undefined> {
  const cacheKey = `${serviceName}:${version || 'latest'}`;
  const cached = getIndividualSpecFromCache(cacheKey);
  if (cached) return cached as OpenApiObject;

  const url = resolveServiceUrl(serviceName, version);
  if (!url) return undefined;

  try {
    const spec = await fetchSpec(url);
    setIndividualSpecCache(cacheKey, spec);
    return spec;
  } catch (error) {
    console.error('Failed to fetch service spec', { serviceName, version, url, error });
    return undefined;
  }
}

export async function getMergedSpec(): Promise<OpenApiObject> {
  const cached = getMergedSpecFromCache();
  if (cached) return cached as OpenApiObject;

  const services = listServices();
  const mergeInput: MergeInputSpec[] = [];

  const settled = await Promise.allSettled(
    services.map(async (service) => {
      const version = service.latest;
      const url = service.versions[version]?.url;
      if (!url) {
        throw new Error(`No URL found for latest version: ${service.name}:${version}`);
      }
      const spec = await fetchSpec(url);
      return { service, version, spec };
    }),
  );

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      mergeInput.push(result.value);
      continue;
    }
    console.error('Skipping service during merge because fetch failed', result.reason);
  }

  if (mergeInput.length === 0) {
    throw new Error('No service specs available to merge');
  }

  const merged = mergeSpecs(mergeInput);
  setMergedSpecCache(merged);
  return merged;
}
