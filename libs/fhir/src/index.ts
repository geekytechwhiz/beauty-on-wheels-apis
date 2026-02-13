export {
  validateFhirResource,
  type ValidationSuccess,
  type ValidationFailure,
  type ValidationResult,
  type OperationOutcome,
  type OperationOutcomeIssue,
  type FhirVersion,
} from './validators/validateFhirResource';
export {
  canonicalToFhirPatient,
  type FhirPatient,
} from './mappers/canonicalToFhirPatient';
export {
  canonicalToFhirObservation,
  type FhirObservation,
} from './mappers/canonicalToFhirObservation';
