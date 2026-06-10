export class FhirValidatorService {
  constructor(
    private readonly structureValidator: any,
    private readonly terminologyValidator: any,
    private readonly referenceValidator: any,
    private readonly customRuleValidator: any,
  ) {}

  validate(resource: any) {
    const results = [
      this.structureValidator.validate(resource),
      this.terminologyValidator.validate(resource),
      this.referenceValidator.validate(resource),
      this.customRuleValidator.validate(resource),
    ];

    const issues = results.flatMap(r => r.issues);

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}