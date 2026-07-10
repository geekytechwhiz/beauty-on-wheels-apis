#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SERVICE = process.argv[2];
const OPENAPI = process.argv[3];

if (!SERVICE || !OPENAPI) {
  console.error('');
  console.error('Usage:');
  console.error('');
  console.error(
    'node tools/codegen/03-parse-openapi.js identity ./openapi.yaml',
  );
  console.error('');
  process.exit(1);
}

if (!fs.existsSync(OPENAPI)) {
  console.error('');
  console.error(`OpenAPI file not found: ${OPENAPI}`);
  console.error('');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Load OpenAPI                                                               */
/* -------------------------------------------------------------------------- */

const openApi = yaml.load(fs.readFileSync(OPENAPI, 'utf8'));

const metadata = {
  service: SERVICE,

  openApiFile: path.resolve(OPENAPI),

  title: openApi.info?.title ?? '',

  version: openApi.info?.version ?? '',

  description: openApi.info?.description ?? '',

  servers: openApi.servers ?? [],

  resources: [],

  schemas: openApi.components?.schemas ?? {},
};

const resourcesByTag = new Map();

const paths = openApi.paths ?? {};

Object.entries(paths).forEach(([route, methods]) => {
  Object.entries(methods).forEach(([method, operation]) => {
    const tag = operation.tags?.[0] ?? 'Default';

    if (!resourcesByTag.has(tag)) {
      resourcesByTag.set(tag, {
        name: tag,

        fileName: kebab(tag),

        className: pascal(tag),

        operations: [],
      });
    }

    const resource = resourcesByTag.get(tag);

    resource.operations.push(buildOperation(route, method, operation));
  });
});

metadata.resources = [...resourcesByTag.values()];

/* -------------------------------------------------------------------------- */
/* Save                                                                        */
/* -------------------------------------------------------------------------- */

const outputDir = path.join(process.cwd(), '.codegen');

fs.mkdirSync(outputDir, {
  recursive: true,
});

const outputFile = path.join(outputDir, `${SERVICE}.json`);

fs.writeFileSync(outputFile, JSON.stringify(metadata, null, 2));

console.log('');
console.log('✔ OpenAPI parsed successfully');
console.log(outputFile);
console.log('');

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function buildOperation(route, method, operation) {
  const operationId = operation.operationId ?? guessName(route, method);

  const successResponse =
    operation.responses?.['200'] ??
    operation.responses?.['201'] ??
    operation.responses?.['202'];

  const responses = Object.entries(operation.responses || {}).map(([statusCode, resObj]) => {
    const refObj = buildSchemaReference(resObj.content?.['application/json']?.schema);
    return {
      statusCode: parseInt(statusCode, 10),
      description: resObj.description || '',
      bodyType: refObj ? refObj.name : null
    };
  });

  return {
    operationId,

    name: pascal(operationId),

    methodName: camel(operationId),

    handlerName: `handle${pascal(operationId)}`,

    controllerMethod: `handle${pascal(operationId)}`,

    serviceMethod: camel(operationId),

    repositoryMethod: camel(operationId),

    method: method.toUpperCase(),

    path: route,

    summary: operation.summary ?? '',

    description: operation.description ?? '',

    tags: operation.tags ?? [],

    security: operation.security ?? [],

    parameters: operation.parameters ?? [],

    request: buildSchemaReference(
      operation.requestBody?.content?.['application/json']?.schema,
    ),

    response: buildSchemaReference(
      successResponse?.content?.['application/json']?.schema,
    ),

    responses,
  };
}

function buildSchemaReference(schema) {
  if (!schema) {
    return null;
  }

  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();

    return {
      name,

      ref: schema.$ref,
    };
  }

  return {
    name: null,

    schema,
  };
}

function guessName(route, method) {
  const segments = route

    .split('/')

    .filter(Boolean)

    .map((segment) => segment.replace(/[{}]/g, ''));

  if (!segments.length) {
    return method.toLowerCase();
  }

  return method.toLowerCase() + pascal(segments[segments.length - 1]);
}

function pascal(value) {
  return value

    .replace(/[-_]/g, ' ')

    .replace(
      /\w+/g,
      (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )

    .replace(/\s/g, '');
}

function camel(value) {
  const p = pascal(value);

  return p.charAt(0).toLowerCase() + p.slice(1);
}

function kebab(value) {
  return value

    .replace(/([a-z])([A-Z])/g, '$1-$2')

    .replace(/\s+/g, '-')

    .replace(/_/g, '-')

    .toLowerCase();
}
