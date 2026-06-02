import { ValidationIssue } from './fhir.validator';

export type OperationOutcomeSeverity =
  | 'fatal'
  | 'error'
  | 'warning'
  | 'information';

export interface OperationOutcomeIssue {
  severity: OperationOutcomeSeverity;
  code: string;
  diagnostics?: string;
  expression?: string[];
}

export interface OperationOutcome {
  resourceType: 'OperationOutcome';
  issue: OperationOutcomeIssue[];
}

const VALIDATION_CODE_TO_OUTCOME: Record<string, string> = {
  RESOURCE_MISSING: 'required',
  REQUIRED_FIELD_MISSING: 'required',
  INVALID_RESOURCE_TYPE: 'invalid',
};

export function buildOperationOutcome(
  issues: ValidationIssue[],
  resourceType?: string,
): OperationOutcome {
  return {
    resourceType: 'OperationOutcome',
    issue: issues.map((issue) => toOperationOutcomeIssue(issue, resourceType)),
  };
}

function toOperationOutcomeIssue(
  issue: ValidationIssue,
  resourceType?: string,
): OperationOutcomeIssue {
  const outcome: OperationOutcomeIssue = {
    severity: issue.severity === 'warning' ? 'warning' : 'error',
    code: VALIDATION_CODE_TO_OUTCOME[issue.code] ?? 'invalid',
    diagnostics: issue.diagnostics,
  };

  const expression = toExpression(issue, resourceType);
  if (expression) {
    outcome.expression = [expression];
  }

  return outcome;
}

function toExpression(
  issue: ValidationIssue,
  resourceType?: string,
): string | undefined {
  if (issue.field) {
    return resourceType ? `${resourceType}.${issue.field}` : issue.field;
  }

  if (issue.code === 'INVALID_RESOURCE_TYPE') {
    return resourceType
      ? `${resourceType}.resourceType`
      : 'resourceType';
  }

  if (issue.code === 'RESOURCE_MISSING') {
    return resourceType ?? undefined;
  }

  const match = issue.diagnostics.match(/^Required field missing: (.+)$/);
  if (match?.[1]) {
    const field = match[1];
    return resourceType ? `${resourceType}.${field}` : field;
  }

  return undefined;
}
