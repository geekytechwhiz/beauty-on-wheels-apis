type OperationOutcomeIssue = {
  severity?: string;
  diagnostics?: string;
  details?: { text?: string };
  location?: string[];
  expression?: string[];
};

type OperationOutcome = {
  resourceType?: string;
  issue?: OperationOutcomeIssue[];
};

const DEFAULT_TIMEOUT_MS = 8000;

function isHapiValidationEnabled(): boolean {
  const raw = (process.env.FHIR_ENABLE_HAPI_VALIDATION ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function getHapiBaseUrl(): string | undefined {
  const url = (process.env.FHIR_HAPI_VALIDATOR_URL ?? '').trim();
  return url === '' ? undefined : url.replace(/\/+$/, '');
}

function getHl7BaseUrl(): string | undefined {
  const url = (process.env.FHIR_HL7_VALIDATOR_URL ?? '').trim();
  return url === '' ? undefined : url.replace(/\/+$/, '');
}

function getTimeoutMs(): number {
  const raw = Number(process.env.FHIR_HAPI_VALIDATOR_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.floor(raw);
}

function getBestIssueMessage(issue: OperationOutcomeIssue): string {
  const details = issue.details?.text?.trim();
  if (details) {
    return details;
  }
  const diagnostics = issue.diagnostics?.trim();
  if (diagnostics) {
    return diagnostics;
  }
  const location = issue.expression?.[0] ?? issue.location?.[0];
  if (location) {
    return `Validation issue at ${location}`;
  }
  return 'FHIR payload failed strict validation';
}

async function validateWithEndpoint(
  endpointName: 'HAPI' | 'HL7',
  baseUrl: string,
  resource: unknown
): Promise<void> {
  const controller = new AbortController();
  const timeoutMs = getTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/$validate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/fhir+json',
        accept: 'application/fhir+json',
      },
      body: JSON.stringify(resource),
      signal: controller.signal,
    });

    const payload = (await response.json()) as OperationOutcome;
    const issues = Array.isArray(payload.issue) ? payload.issue : [];
    const errorIssue = issues.find((issue) => {
      const severity = String(issue.severity ?? '').toLowerCase();
      return severity === 'error' || severity === 'fatal';
    });

    if (!response.ok || errorIssue) {
      throw new Error(
        `${endpointName} validation failed: ${getBestIssueMessage(errorIssue ?? {})}`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${endpointName} validation timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateWithHapi(resource: unknown): Promise<void> {
  if (!isHapiValidationEnabled()) {
    return;
  }

  const baseUrl = getHapiBaseUrl();
  const hl7Url = getHl7BaseUrl();
  const targets: Array<{ name: 'HAPI' | 'HL7'; url: string }> = [];

  if (baseUrl) {
    targets.push({ name: 'HAPI', url: baseUrl });
  }
  if (hl7Url) {
    targets.push({ name: 'HL7', url: hl7Url });
  }

  if (targets.length === 0) {
    throw new Error(
      'FHIR strict validation enabled but no validator URL is configured. Set FHIR_HAPI_VALIDATOR_URL and/or FHIR_HL7_VALIDATOR_URL'
    );
  }

  for (const target of targets) {
    await validateWithEndpoint(target.name, target.url, resource);
  }
}
