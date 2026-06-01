import { bootstrapFhirLibrary } from '../bootstrap';

bootstrapFhirLibrary();

export type { FhirHandlerOptions } from '../mapper/transform-to-fhir-response';
export {
  isFhirEnabled,
  transformToFhirResponse,
} from '../mapper/transform-to-fhir-response';
export {
  fhirValidationErrorResponse,
  FhirValidationError,
} from '../mapper/fhir-error-response';
export { fhirSuccessResponse } from '../mapper/fhir-success-response';
export { isFhirValidationErrorLike } from '../mapper/is-fhir-validation-error-like';
export { isFhirRequest } from '../mapper/is-fhir-request';
export {
  shouldTransformFhirRequest,
  transformFhirRequest,
} from '../mapper/transform-fhir-request';
