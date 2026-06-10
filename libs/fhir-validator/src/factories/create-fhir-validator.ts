import { MetadataRegistry } from '../registry/metadata-registry';
import { MappingRegistry } from '../registry/mapping-registry';
import { ConfigRegistry } from '../registry/config-registry';
import { StructureValidator } from '../validators/structure.validator';
import { TerminologyValidator } from '../validators/terminology.validator';
import { ReferenceValidator } from '../validators/reference.validator';
import { CustomRuleValidator } from '../validators/custom-rule.validator';
import { FhirValidatorService } from '../services/fhir-validator.service';

export function createFhirValidator(dependencies: {
  metadata: Record<string, any>;
  mappings: Record<string, any>;
  configs: Record<string, any>;
  terminology: Record<string, string[]>;
}) {
  const metadataRegistry = new MetadataRegistry(dependencies.metadata);
  const mappingRegistry = new MappingRegistry(dependencies.mappings);
  const configRegistry = new ConfigRegistry(dependencies.configs);

  return new FhirValidatorService(
    new StructureValidator(metadataRegistry),
    new TerminologyValidator(mappingRegistry, {
      get: (system: string) => dependencies.terminology[system],
    }),
    new ReferenceValidator(mappingRegistry),
    new CustomRuleValidator(),
  );
}