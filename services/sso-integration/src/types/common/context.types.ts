 

export enum SourceSystem {
  HMS = 'HMS',
  FHIR = 'FHIR',
  CUSTOM = 'CUSTOM',
  MARKETPLACE = 'MARKETPLACE',
}
export interface SSORequestContext {
  correlationId: string;
  tenantId: string;
  serviceToken: string | null;
  source?: string;
  integration: IntegrationMetadata;
  sourceSystem: SourceSystem;
}

export interface IntegrationMetadata {
  providerId: string;
  subdomain: string;
  externalHospitalId?: string;
} 
 

export const deriveTenantIdFromIntegration = (
  integration: IntegrationMetadata,
): string => {
  return integration.subdomain;
};

