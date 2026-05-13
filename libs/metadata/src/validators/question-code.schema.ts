import { ValidationError } from '../domain/errors';

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}

export interface ValidateQuestionCodeAttributesOpts {
  /** When set (e.g. from active QuestionType metadata values), `questionType` must match a catalog code. */
  allowedQuestionTypeCodes?: readonly string[];
}

/**
 * Validates QuestionCode `value.attributes` (value-level structured fields).
 * Mandatory: questionText, questionType, thresholdEligible. Optional: answerScale.
 */
export function validateQuestionCodeAttributes(
  attributes: Record<string, unknown>,
  opts?: ValidateQuestionCodeAttributesOpts,
): void {
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
  if (opts?.allowedQuestionTypeCodes !== undefined) {
    if (opts.allowedQuestionTypeCodes.length === 0) {
      throw new ValidationError('QuestionType metadata has no active values; cannot validate questionType', [
        { field: 'attributes.questionType', message: 'Catalog empty' },
      ]);
    }
    const allowed = new Set(opts.allowedQuestionTypeCodes);
    const qt = String(attributes.questionType).trim();
    if (!allowed.has(qt)) {
      const sample = [...allowed].sort().slice(0, 20).join(', ');
      const suffix = allowed.size > 20 ? ', …' : '';
      throw new ValidationError('Invalid enum value for questionType', [
        {
          field: 'attributes.questionType',
          message: `Must be an active QuestionType metadata value code (e.g. ${sample}${suffix})`,
        },
      ]);
    }
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
