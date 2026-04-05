import { isErrorResult, merge } from 'openapi-merge';
import type { ServiceRegistryEntry } from '../config/services';

export interface OpenApiObject {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, unknown>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MergeInputSpec {
  service: ServiceRegistryEntry;
  version: string;
  spec: OpenApiObject;
}

function sanitizeToken(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, '_');
}

export function mergeSpecs(inputSpecs: MergeInputSpec[]): OpenApiObject {
  const base: OpenApiObject = {
    openapi: '3.0.3',
    info: {
      title: 'Aggregated API Registry',
      version: '1.0.0',
      description: 'Merged OpenAPI from registry-managed services',
    },
    paths: {},
  };

  const mergeInputs = [
    { oas: base },
    ...inputSpecs.map((item) => ({
      oas: item.spec,
      pathModification: { prepend: `/${item.service.name}/${item.version}` },
      dispute: {
        prefix: `${sanitizeToken(item.service.name)}_${sanitizeToken(item.version)}_`,
        alwaysApply: true,
      },
    })),
  ];

  const merged = merge(mergeInputs);
  if (isErrorResult(merged)) {
    throw new Error(`Failed to merge OpenAPI specs: ${merged.type} ${merged.message}`);
  }

  const output = merged.output as OpenApiObject;
  injectCustomExtensions(output, inputSpecs);
  return output;
}

export function injectCustomExtensions(
  spec: OpenApiObject,
  mergedInputs: MergeInputSpec[],
): void {
  const pathEntries = Object.entries(spec.paths || {});
  for (const [pathKey, pathValue] of pathEntries) {
    const tokens = pathKey.split('/').filter(Boolean);
    if (tokens.length < 2) continue;
    const [serviceName] = tokens;
    const matched = mergedInputs.find((item) => item.service.name === serviceName);
    if (!matched || typeof pathValue !== 'object' || pathValue === null) continue;

    const pathObject = pathValue as Record<string, unknown>;
    pathObject['x-service-name'] = matched.service.name;
    if (matched.service.module) pathObject['x-module'] = matched.service.module;
    if (matched.service.rules) pathObject['x-rules'] = matched.service.rules;
  }
}
