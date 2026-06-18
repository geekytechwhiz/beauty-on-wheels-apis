/** Downstream areas that may reference published metadata. */
export const METADATA_CONSUMER = {
  TEMPLATE: 'Template',
  ORG_CAPABILITY: 'OrgCapability',
  PACKAGE: 'Package',
  SERVICE_CATALOG: 'ServiceCatalog',
  APPOINTMENT: 'Appointment',
  RUNTIME: 'Runtime',
} as const;

export type MetadataConsumerKind = (typeof METADATA_CONSUMER)[keyof typeof METADATA_CONSUMER];

/** Consumers that currently adopt or reference the metadata under evaluation. */
export interface MetadataConsumerContext {
  adoptedConsumers: MetadataConsumerKind[];
}

export interface ResolveMetadataConsumerContextInput {
  entityType: 'type' | 'value';
  metadataTypeCode: string;
  metadataValueCode?: string;
  /** True when the entity does not exist in the published registry yet. */
  isFirstTimeCreate: boolean;
}

export interface PolicyConsumerFlags {
  requiresTemplateAdoption: boolean;
  requiresOrgCapabilityReevaluation: boolean;
  runtimeImpact: string;
}

export interface ResolvedConsumerImpact {
  requiresTemplateAdoption: boolean;
  requiresOrgCapabilityReevaluation: boolean;
  affectedConsumers: MetadataConsumerKind[];
}
