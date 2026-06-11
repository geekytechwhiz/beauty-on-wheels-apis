/* eslint-disable @nx/enforce-module-boundaries */
import '@api-hub/fhir';

import { FhirValidatorService } from '../services/fhir-validator.service';
import { CustomRuleValidator } from '../validators/custom-rule.validator';
import { ReferenceValidator } from '../validators/reference.validator';
import { StructureValidator } from '../validators/structure.validator';
import { TerminologyValidator } from '../validators/terminology.validator';

let validator: FhirValidatorService | undefined;

export function getFhirValidator() {
  if (!validator) {
    validator = new FhirValidatorService(
      new StructureValidator(),
      new TerminologyValidator(),
      new ReferenceValidator(),
      new CustomRuleValidator(),
    );
  }

  return validator;
}
