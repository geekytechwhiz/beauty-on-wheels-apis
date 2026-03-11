import { IntegrationMetadata, UserSourceSystem } from '../types/integration.types';

export interface RequestContext {
  correlationId: string;
  tenantId: string;
  serviceToken: string;
  source?: string;
  integration?: IntegrationMetadata;
  sourceSystem?: UserSourceSystem;
}