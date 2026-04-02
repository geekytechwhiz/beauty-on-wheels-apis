import { evaluateCondition, evaluatePredicate } from './index';

describe('rule evaluator', () => {
  it('evaluates predicates against nested facts', () => {
    const evaluation = evaluatePredicate(
      {
        fact: 'patient.age',
        operator: 'greaterThanOrEqual',
        value: 18,
      },
      {
        patient: {
          age: 24,
        },
      },
    );

    expect(evaluation.matched).toBe(true);
    expect(evaluation.trace.actual).toBe(24);
  });

  it('evaluates nested all and any conditions', () => {
    const evaluation = evaluateCondition(
      {
        all: [
          { fact: 'country', operator: 'equal', value: 'US' },
          {
            any: [
              { fact: 'plan', operator: 'equal', value: 'premium' },
              { fact: 'visits', operator: 'greaterThan', value: 3 },
            ],
          },
        ],
      },
      {
        country: 'US',
        plan: 'basic',
        visits: 4,
      },
    );

    expect(evaluation.matched).toBe(true);
    expect(evaluation.trace.operator).toBe('all');
    expect(evaluation.trace.children).toHaveLength(2);
  });
});
