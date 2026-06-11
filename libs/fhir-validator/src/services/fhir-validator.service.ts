import { CustomRuleValidator } from '../validators/custom-rule.validator';
import { ReferenceValidator } from '../validators/reference.validator';
import { StructureValidator } from '../validators/structure.validator';
import { TerminologyValidator } from '../validators/terminology.validator';
import { ValidationIssue } from '../models/validation-issue';
import { ValidationResult } from '../models/validation-result';

export class FhirValidatorService {
  constructor(
    private readonly structureValidator: StructureValidator,
    private readonly terminologyValidator: TerminologyValidator,
    private readonly referenceValidator: ReferenceValidator,
    private readonly customRuleValidator: CustomRuleValidator,
  ) {}

  validate(resource: Record<string, unknown>, version = 'R4'): ValidationResult {
    if (resource?.resourceType === 'Bundle') {
      return this.validateBundle(resource, version);
    }

    return this.validateResource(resource, version);
  }

  validateBundle(bundle: Record<string, unknown>, version = 'R4'): ValidationResult {
    const issues: ValidationIssue[] = [];
    const entries = Array.isArray(bundle.entry) ? bundle.entry : [];

    for (const entry of entries) {
      const nested =
        entry != null &&
        typeof entry === 'object' &&
        'resource' in entry &&
        (entry as { resource?: unknown }).resource != null &&
        typeof (entry as { resource?: unknown }).resource === 'object'
          ? ((entry as { resource: Record<string, unknown> }).resource)
          : undefined;

      if (!nested) {
        continue;
      }

      const result = this.validateResource(nested, version);
      issues.push(...result.issues);
    }

    return { valid: issues.length === 0, issues };
  }

  private validateResource(
    resource: Record<string, unknown>,
    version: string,
  ): ValidationResult {
    const results = [
      this.structureValidator.validate(resource, version),
      this.terminologyValidator.validate(resource, version),
      this.referenceValidator.validate(resource, version),
      this.customRuleValidator.validate(resource, version),
    ];

    const issues = results.flatMap((result) => result.issues);

    return {
      valid: issues.length === 0,
      issues: dedupeIssues(issues),
    };
  }
}

function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = `${issue.validator}|${issue.path}|${issue.code}|${issue.message}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
