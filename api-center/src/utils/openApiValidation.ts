import { parseOpenApiText } from '../services/specCatalogService';

export type OpenApiIssueSeverity = 'error' | 'warning';

export interface OpenApiValidationIssue {
  id: string;
  severity: OpenApiIssueSeverity;
  message: string;
  field: string;
  suggestion: string;
  endpointPath: string;
  method: string;
  responseStatus: string;
  line?: number;
  column?: number;
  rawMessage: string;
}

const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
]);

function toTitleMethod(method: string): string {
  return method.toUpperCase();
}

function normalizePathParts(pathValue: unknown): string[] {
  if (Array.isArray(pathValue)) {
    return pathValue.map((item) => String(item));
  }
  if (typeof pathValue === 'string') {
    return pathValue.split('/').filter(Boolean);
  }
  return [];
}

function extractLocation(pathParts: string[]): {
  endpointPath: string;
  method: string;
  responseStatus: string;
  field: string;
} {
  const pathsIndex = pathParts.findIndex((part) => part === 'paths');
  let endpointPath = 'Unknown path';
  let method = 'N/A';
  let responseStatus = 'N/A';
  const field = pathParts[pathParts.length - 1] ?? 'unknown';

  if (pathsIndex >= 0 && pathParts[pathsIndex + 1]) {
    endpointPath = pathParts[pathsIndex + 1];
    const maybeMethod = pathParts[pathsIndex + 2]?.toLowerCase();
    if (maybeMethod && HTTP_METHODS.has(maybeMethod)) {
      method = toTitleMethod(maybeMethod);
    }
    const responsesIndex = pathParts.findIndex((part) => part === 'responses');
    if (responsesIndex >= 0 && pathParts[responsesIndex + 1]) {
      responseStatus = pathParts[responsesIndex + 1];
    }
  }

  return { endpointPath, method, responseStatus, field };
}

function friendlyMessage(rawMessage: string): string {
  if (/\$ref/i.test(rawMessage) && /(not found|missing|unresolved|pointer)/i.test(rawMessage)) {
    return 'A referenced schema could not be found.';
  }
  if (/oneOf|allOf/i.test(rawMessage)) {
    return 'Schema composition is invalid or ambiguous.';
  }
  if (/type/i.test(rawMessage) && /should|must|invalid/i.test(rawMessage)) {
    return 'The schema uses an incorrect value type.';
  }
  return rawMessage;
}

function fixSuggestion(rawMessage: string): string {
  if (/\$ref/i.test(rawMessage) && /(not found|missing|unresolved|pointer)/i.test(rawMessage)) {
    return 'Check that the $ref path exists and points to a valid schema key.';
  }
  if (/oneOf|allOf/i.test(rawMessage)) {
    return 'Ensure each oneOf/allOf branch is valid and avoid conflicting required/type constraints.';
  }
  if (/type/i.test(rawMessage) && /should|must|invalid/i.test(rawMessage)) {
    return 'Match the schema type to actual data (string, number, boolean, object, array).';
  }
  return 'Review the schema at this location and align it with OpenAPI 3.x structure.';
}

function estimateLine(source: string, tokens: string[]): number | undefined {
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const matches = tokens.some((token) => token && line.includes(token));
    if (matches) {
      return index + 1;
    }
  }
  return undefined;
}

function buildIssueFromDetail(
  detail: unknown,
  fallbackMessage: string,
  sourceText: string,
  index: number,
): OpenApiValidationIssue {
  const detailObject = (detail ?? {}) as Record<string, unknown>;
  const rawMessage =
    typeof detailObject.message === 'string'
      ? detailObject.message
      : typeof detailObject.error === 'string'
        ? detailObject.error
        : fallbackMessage;
  const pathParts = normalizePathParts(detailObject.path);
  const location = extractLocation(pathParts);
  const line = estimateLine(sourceText, [
    location.endpointPath,
    location.method.toLowerCase(),
    location.responseStatus,
    location.field,
  ]);

  return {
    id: `error-${index}-${pathParts.join('.')}`,
    severity: 'error',
    message: friendlyMessage(rawMessage),
    field: location.field,
    suggestion: fixSuggestion(rawMessage),
    endpointPath: location.endpointPath,
    method: location.method,
    responseStatus: location.responseStatus,
    line,
    column: 1,
    rawMessage,
  };
}

function collectHeuristicWarnings(
  parsedSpec: Record<string, unknown>,
  sourceText: string,
): OpenApiValidationIssue[] {
  const warnings: OpenApiValidationIssue[] = [];
  const specAsText = JSON.stringify(parsedSpec);

  if (/"oneOf"\s*:/.test(specAsText) && /"type"\s*:/.test(specAsText)) {
    warnings.push({
      id: 'warning-oneof-type-mix',
      severity: 'warning',
      message: 'Schema mixes oneOf/allOf with explicit type in ways that can be confusing.',
      field: 'oneOf/allOf',
      suggestion: 'Prefer clear discriminator rules or remove redundant type declarations.',
      endpointPath: 'Multiple paths',
      method: 'N/A',
      responseStatus: 'N/A',
      line: estimateLine(sourceText, ['oneOf', 'allOf']),
      column: 1,
      rawMessage: 'Heuristic warning for oneOf/allOf usage.',
    });
  }

  return warnings;
}

export async function validateOpenApiForEditor(
  sourceText: string,
): Promise<OpenApiValidationIssue[]> {
  if (!sourceText.trim()) {
    return [];
  }

  let parsedSpec: Record<string, unknown>;
  try {
    parsedSpec = parseOpenApiText(sourceText, 'yaml');
  } catch (error) {
    const yamlError = error as { message?: string; mark?: { line?: number; column?: number } };
    return [
      {
        id: 'parse-error',
        severity: 'error',
        message: 'YAML syntax is invalid.',
        field: 'document',
        suggestion: 'Fix indentation, colons, or list formatting near the highlighted line.',
        endpointPath: 'Unknown path',
        method: 'N/A',
        responseStatus: 'N/A',
        line: typeof yamlError.mark?.line === 'number' ? yamlError.mark.line + 1 : undefined,
        column:
          typeof yamlError.mark?.column === 'number' ? yamlError.mark.column + 1 : undefined,
        rawMessage: yamlError.message ?? 'Unable to parse YAML.',
      },
    ];
  }

  try {
    const { default: SwaggerParser } = await import('@apidevtools/swagger-parser');
    await SwaggerParser.validate(parsedSpec as unknown as string);
    return collectHeuristicWarnings(parsedSpec, sourceText);
  } catch (error) {
    const parserError = error as { message?: string; details?: unknown[] };
    const fallbackMessage = parserError.message ?? 'OpenAPI validation failed.';
    const details = Array.isArray(parserError.details) ? parserError.details : [];
    const mapped =
      details.length > 0
        ? details.map((detail, index) => buildIssueFromDetail(detail, fallbackMessage, sourceText, index))
        : [
            buildIssueFromDetail(
              { message: fallbackMessage, path: ['openapi'] },
              fallbackMessage,
              sourceText,
              0,
            ),
          ];

    return [...mapped, ...collectHeuristicWarnings(parsedSpec, sourceText)];
  }
}
