import objectPath from 'object-path';

import {
  ClientMappingRegistry,
  MappingRegistry,
  MappingResolver,
} from '../resolver/mapping.resolver';

import {
  clientMappingRegistry,
  defaultMappingRegistry,
  ResourceMappingConfig,
  MappingField,
} from '../registry/mapping.registry';

import { GenericMapper } from '../mapper/generic-fhir.mapper';

import { FhirValidator } from '../validator/fhir.validator';

import {
  defaultTerminologyService,
  TerminologyService,
} from '../terminology/terminology.service';

import { ResourceDiscoveryService } from './resource-discovery.service';
import { isRecord } from '../utils/data-shape';

export interface FhirTransformationConfig {
  baseUrl?: string;

  validate?: boolean;

  clientConfig?: Record<string, unknown>;

  version?: 'R4' | 'R5';
}

export interface FhirProjectionOptions {
  resourceTypes?: string[];
  clientId?: string;
  version?: 'R4' | 'R5';
}

export class FhirTransformationService {
  private discoveryService?: ResourceDiscoveryService;

  constructor(
    private readonly mappingResolver: MappingResolver = new MappingResolver(
      defaultMappingRegistry as MappingRegistry,
      clientMappingRegistry as ClientMappingRegistry,
    ),

    private readonly genericMapper: GenericMapper = new GenericMapper(),

    private readonly terminology: TerminologyService = defaultTerminologyService,

    private readonly validator: FhirValidator = new FhirValidator(),

    discoveryService?: ResourceDiscoveryService,
  ) {
    this.discoveryService = discoveryService;
  }

  /**
   * Canonical → strict FHIR projection resources for one or more business objects.
   * Auto-detects resource types unless explicit resourceTypes are provided.
   */
  async transformToProjection(
    data: unknown,
    options: FhirProjectionOptions = {},
  ): Promise<Record<string, unknown>[]> {
    const discovery = this.getDiscoveryService();
    const items = normalizeProjectionInput(data);
    const resources: Record<string, unknown>[] = [];

    for (const item of items) {
      const mappers = discovery.discover(item, options.resourceTypes);

      for (const mapper of mappers) {
        const resource = await mapper.map(item, options.clientId);
        resources.push(resource);
      }
    }

    return resources;
  }

  private getDiscoveryService(): ResourceDiscoveryService {
    if (!this.discoveryService) {
      this.discoveryService = ResourceDiscoveryService.createDefault(this);
    }

    return this.discoveryService;
  }

  /**
   * Canonical → hybrid FHIR-compatible payload.
   * Preserves all canonical fields; adds mapped FHIR paths and extensions.
   */
  async transformCanonicalToHybridFhir<TCanonical>(
    resourceType: string,
    canonical: TCanonical,
    clientId?: string,
    config: FhirTransformationConfig = {},
  ): Promise<Record<string, unknown>> {
    const mapping = this.resolveMapping(resourceType, clientId, config.version);

    const hybrid = this.genericMapper.mapHybrid(
      canonical as Record<string, unknown>,
      mapping,
    );

    this.normalizeTerminology(hybrid, mapping);

    if (config.validate === true) {
      await this.validator.validateResource({
        resource: hybrid,
        resourceType,
        version: mapping.version,
        profile: mapping.profile,
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
  ): Promise<any> {
    const mapping = this.resolveMapping(resourceType, clientId, config.version);

    /**
     * Step 1
     * Canonical → FHIR
     */

    const resource = this.genericMapper.mapStrict(
      canonical as Record<string, unknown>,
      mapping,
    );

    /**
     * Step 2
     * Terminology normalization
     */

    this.normalizeTerminology(resource, mapping);

    /**
     * Step 3
     * Validation
     */

    if (config.validate !== false) {
      await this.validator.validateResource({
        resource,

        resourceType,

        version: mapping.version,

        profile: mapping.profile,
      });
    }

    return resource;
  }

  /**
   * FHIR → Canonical
   */

  async transformFhirToCanonical(
    resourceType: string,

    resource: any,

    clientId?: string,

    config: FhirTransformationConfig = {},
  ): Promise<any> {
    const mapping = this.resolveMapping(resourceType, clientId, config.version);

    return this.genericMapper.reverseMap(resource, mapping);
  }

  /**
   * Common mapping resolution
   */

  private resolveMapping(
    resourceType: string,

    clientId?: string,

    version?: string,
  ): ResourceMappingConfig {
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
   * Metadata-driven terminology handling
   */

  private normalizeTerminology(
    resource: any,

    mapping: ResourceMappingConfig,
  ): void {
    if (!mapping.fields?.length) return;

    for (const field of mapping.fields) {
      this.normalizeField(resource, field);
    }
  }

  private normalizeField(

    resource: any,

    field: MappingField

): void {

    if (!field.system) {
        return;
    }

    const value =
        objectPath.get(
            resource,
            field.target
        );

    if (
        value === undefined ||
        value === null
    ) {
        return;
    }

    /**
     * Normalize only primitive values
     */

    if (
        typeof value !== 'string' &&
        typeof value !== 'number'
    ) {
        return;
    }

    const normalized =
    this.terminology.normalizeCode(
        field.system,
        String(value)
    );

    objectPath.set(
        resource,
        field.target,
        normalized.code
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
