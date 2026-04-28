import { ValidationError } from '../domain/errors';

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}

/**
 * Validates QuestionCode `value.attributes` (value-level structured fields).
 * Mandatory: questionText, questionType, thresholdEligible. Optional: answerScale.
 */
export function validateQuestionCodeAttributes(attributes: Record<string, unknown>): void {
  if (!isNonEmptyString(attributes.questionText)) {
    throw new ValidationError('QuestionCode attributes require questionText', [
      { field: 'attributes.questionText', message: 'Required' },
    ]);
  }
  if (!isNonEmptyString(attributes.questionType)) {
    throw new ValidationError('QuestionCode attributes require questionType', [
      { field: 'attributes.questionType', message: 'Required' },
    ]);
  }
  if (typeof attributes.thresholdEligible !== 'boolean') {
    throw new ValidationError('QuestionCode attributes require thresholdEligible (boolean)', [
      { field: 'attributes.thresholdEligible', message: 'Required' },
    ]);
  }
  if (attributes.answerScale !== undefined && typeof attributes.answerScale !== 'string') {
    throw new ValidationError('answerScale must be a string', [{ field: 'attributes.answerScale', message: 'Invalid' }]);
  }
}
