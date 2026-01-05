/**
 * FHIR Library
 * Exports all FHIR-related functionality
 */

// Models
export * from './models/r4/common';
export * from './models/r4/patient';
export * from './models/r4/practitioner';
export * from './models/r4/related-person';
export * from './models/r4/user';

// Adapters
export * from './adapters/identity/patient.adapter';
export * from './adapters/identity/practitioner.adapter';
export * from './adapters/identity/related-person.adapter';
export * from './adapters/identity/user.adapter';

// Utilities
export * from './utils/reference';
export * from './utils/coding';
export * from './utils/date';

// Validation
export * from './validation/validator';

// Types
export * from './types/internal';

