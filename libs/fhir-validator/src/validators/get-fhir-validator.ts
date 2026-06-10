import {
  mappingRegistry,
  resourceRegistry,
  clientMappingRegistry,
} from '@api-hub/fhir';
 
import { FhirValidatorService } from '../services/fhir-validator.service';

import { StructureValidator } from '../validators/structure.validator';
import { TerminologyValidator } from '../validators/terminology.validator';
import { ReferenceValidator } from '../validators/reference.validator';
import { CustomRuleValidator } from '../validators/custom-rule.validator';

let validator: FhirValidatorService | undefined;

export function getFhirValidator() {
  if (!validator) {
    validator = new FhirValidatorService(
      new StructureValidator(resourceRegistry),
      new TerminologyValidator(mappingRegistry, clientMappingRegistry),
      new ReferenceValidator(mappingRegistry),
      new CustomRuleValidator(),
    );
  }

  return validator;
}
