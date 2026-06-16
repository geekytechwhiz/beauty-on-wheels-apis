import { ValidationIssue } from '../models/validation-issue';

export type OperationOutcomeSeverity =
  | 'fatal'
  | 'error'
  | 'warning'
  | 'information';

export type ValidationIssueCategory =
  | 'structure'
  | 'terminology'
  | 'reference'
  | 'businessRule';

export interface ClassifiedOperationOutcomeIssue {
  severity: OperationOutcomeSeverity;
  code: string;
  category: ValidationIssueCategory;
  validator: string;
  diagnostics: string;
  expression?: string[];
}

export interface OperationOutcome {
  resourceType: 'OperationOutcome';
  issue: ClassifiedOperationOutcomeIssue[];
}

export interface BuildOperationOutcomeOptions {
  resourceType?: string;
  /** When true, issues are emitted as warnings (non-blocking validation). */
  nonBlocking?: boolean;
}

const VALIDATOR_CATEGORY: Record<string, ValidationIssueCategory> = {
  StructureValidator: 'structure',
  TerminologyValidator: 'terminology',
  ReferenceValidator: 'reference',
  CustomRuleValidator: 'businessRule',
};

const ISSUE_CODE_TO_OUTCOME: Record<string, string> = {
  RESOURCE_MISSING: 'required',
  REQUIRED: 'required',
  REQUIRED_FIELD_MISSING: 'required',
  INVALID_RESOURCE_TYPE: 'invalid',
  INVALID_CODE: 'value',
  INVALID_REFERENCE: 'invalid',
};

function toCategory(validator: string): ValidationIssueCategory {
  return VALIDATOR_CATEGORY[validator] ?? 'structure';
}

function toOutcomeCode(issueCode: string): string {
  return ISSUE_CODE_TO_OUTCOME[issueCode] ?? 'invalid';
}

function toExpression(
  issue: ValidationIssue,
  resourceType?: string,
): string | undefined {
  if (issue.path) {
    return resourceType ? `${resourceType}.${issue.path}` : issue.path;
  }

  if (issue.code === 'INVALID_RESOURCE_TYPE') {
    return resourceType ? `${resourceType}.resourceType` : 'resourceType';
  }

  if (issue.code === 'RESOURCE_MISSING') {
    return resourceType;
  }

  return undefined;
}

export function buildOperationOutcome(
  issues: ValidationIssue[],
  options: BuildOperationOutcomeOptions = {},
): OperationOutcome {
  const severity: OperationOutcomeSeverity = options.nonBlocking
    ? 'warning'
    : 'error';

  return {
    resourceType: 'OperationOutcome',
    issue: issues.map((issue) => {
      const expression = toExpression(issue, options.resourceType);
      const outcomeIssue: ClassifiedOperationOutcomeIssue = {
        severity,
        code: toOutcomeCode(issue.code),
        category: toCategory(issue.validator),
        validator: issue.validator,
        diagnostics: issue.message,
      };

      if (expression) {
        outcomeIssue.expression = [expression];
      }

      return outcomeIssue;
    }),
  };
}
