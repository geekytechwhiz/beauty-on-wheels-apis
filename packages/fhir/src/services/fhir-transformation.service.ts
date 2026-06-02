import objectPath from 'object-path';

import {
  MappingResolver,
} from '../resolver/mapping.resolver';

 

import { GenericMapper } from '../mapper/generic-fhir.mapper';

import { FhirValidator } from '../validator/fhir.validator';

import {
  defaultTerminologyService,
  TerminologyService,
} from '../terminology/terminology.service';

import { ResourceDiscoveryService } from './resource-discovery.service';

import { isRecord } from '../utils/data-shape';
import { FhirProjectionOptions, FhirTransformationConfig, MappingField, ResourceConfig } from '../types/resource.types';
import { MappingRegistry, mappingRegistry } from '../registry/mapping.registry';
import { clientMappingRegistry, DefaultClientMappingRegistry } from '../registry/client-mapping.registry';


export class FhirTransformationService {
  constructor(
    private readonly mappingResolver = new MappingResolver(
      mappingRegistry  as MappingRegistry,

      clientMappingRegistry as DefaultClientMappingRegistry,
    ),

    private readonly genericMapper = new GenericMapper(),

    private readonly terminology: TerminologyService = defaultTerminologyService,

    private readonly validator = new FhirValidator(),

    private readonly discoveryService = new ResourceDiscoveryService(),
  ) {}

  /**
   * Canonical → projected FHIR resources
   */

  async transformToProjection(
    data: unknown,

    options: FhirProjectionOptions = {},
  ): Promise<Record<string, unknown>[]> {
    const items = normalizeProjectionInput(data);

    const resources: Record<string, unknown>[] = [];

    for (const item of items) {
      const configs = this.discoveryService.discover(
        item,

        options.resourceTypes,
      );

      for (const config of configs) {
        const transformed = await this.transformCanonicalToFhir(
          config.resource,

          item,

          options.clientId,

          {
            validate: true,

            version: options.version,
          },
        );

        resources.push(transformed);
      }
    }

    return resources;
  }

  /**
   * Canonical → Hybrid FHIR
   */

  async transformCanonicalToHybridFhir<TCanonical>(
    resourceType: string,

    canonical: TCanonical,

    clientId?: string,

    config: FhirTransformationConfig = {},
  ): Promise<Record<string, unknown>> {
    const mapping = this.resolveMapping(
      resourceType,

      clientId,

      config.version,
    );

    const hybrid = this.genericMapper.mapHybrid(
      canonical as Record<string, unknown>,

      mapping,
    );

    this.normalizeTerminology(
      hybrid,

      mapping,
    );

    if (config.validate === true) {
      await this.validator.validateResource({
        resource: hybrid,

        resourceType,

        version: mapping.version,

        profile: mapping.profile.join(','),
      });
    }

    return hybrid;
  }

  /**
   * Canonical → FHIR
   */

  async transformCanonicalToFhir<TCanonical>(
    resourceType: string,

    canonical: TCanonical,

    clientId?: string,

    config: FhirTransformationConfig = {},
  ): Promise<Record<string, unknown>> {
    const mapping = this.resolveMapping(
      resourceType,

      clientId,

      config.version,
    );

    const transformed = this.genericMapper.mapStrict(
      canonical as Record<string, unknown>,

      mapping,
    );

    this.normalizeTerminology(
      transformed,

      mapping,
    );

    if (config.validate !== false) {
      await this.validator.validateResource({
        resource: transformed,

        resourceType,

        version: mapping.version,

        profile: mapping.profile.join(','),
      });
    }

    return transformed;
  }

  /**
   * FHIR → Canonical
   */

  async transformFhirToCanonical(
    resourceType: string,

    resourceData: Record<string, unknown>,

    clientId?: string,

    config: FhirTransformationConfig = {},
  ): Promise<Record<string, unknown>> {
    const mapping = this.resolveMapping(
      resourceType,

      clientId,

      config.version,
    );

    return this.genericMapper.reverseMap(
      resourceData,

      mapping,
    );
  }

  /**
   * Mapping resolver
   */

  private resolveMapping(
    resourceType: string,

    clientId?: string,

    version?: string,
  ): ResourceConfig {
    const resolvedVersion = version ?? 'R4';

    try {
      return this.mappingResolver.resolve(
        resourceType,

        clientId ?? '',

        resolvedVersion,
      );
    } catch {
      const error: any = new Error(
        `FHIR mapping not found:
resource=${resourceType}
version=${resolvedVersion}
client=${clientId ?? ''}`,
      );

      error.statusCode = 500;

      error.code = 'FHIR_MAPPING_NOT_FOUND';

      throw error;
    }
  }

  /**
   * Terminology normalization
   */

  private normalizeTerminology(
    resource: Record<string, unknown>,

    mapping: ResourceConfig,
  ): void {
    if (!mapping.fields?.length) {
      return;
    }

    for (const field of mapping.fields) {
      this.normalizeField(
        resource,

        field,
      );
    }
  }

  private normalizeField(
    resource: Record<string, unknown>,

    field: MappingField,
  ): void {
    if (!field.system) {
      return;
    }

    const value = objectPath.get(
      resource,

      field.target,
    );

    if (value === undefined || value === null) {
      return;
    }

    if (typeof value !== 'string' && typeof value !== 'number') {
      return;
    }

    const normalized = this.terminology.normalizeCode(
      field.system,

      String(value),
    );

    objectPath.set(
      resource,

      field.target,

      normalized.code,
    );
  }
}

function normalizeProjectionInput(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }

  if (isRecord(data) && Array.isArray(data.items)) {
    return data.items;
  }

  return [data];
}
