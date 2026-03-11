export interface IntegrationMetadata {
  providerId: string;
  subdomain: string;
  externalHospitalId?: string;
}

export interface ExternalIdentity {
  providerId: string;
  externalUserId: string;
}

export enum UserSourceSystem {
  AFRICA_HMS = 'AFRICA_HMS',
}

export const deriveTenantIdFromIntegration = (
  integration: IntegrationMetadata,
): string => {
  return integration.subdomain;
};

