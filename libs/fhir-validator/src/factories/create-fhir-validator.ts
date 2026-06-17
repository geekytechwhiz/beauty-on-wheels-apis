import { StructureValidator } from '../validators/structure.validator';
import { TerminologyValidator } from '../validators/terminology.validator';
import { ReferenceValidator } from '../validators/reference.validator';
import { CustomRuleValidator } from '../validators/custom-rule.validator';
import { FhirValidatorService } from '../services/fhir-validator.service';

export function createFhirValidator() {
  return new FhirValidatorService(
    new StructureValidator(),
    new TerminologyValidator(),
    new ReferenceValidator(),
    new CustomRuleValidator(),
  );
}