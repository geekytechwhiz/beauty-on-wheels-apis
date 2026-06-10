export class OperationOutcomeBuilder {
  build(issues: any[]) {
    return {
      resourceType: 'OperationOutcome',
      issue: issues.map(i => ({
        severity: 'error',
        code: 'invalid',
        details: { text: i.message },
        expression: [i.path],
      })),
    };
  }
}