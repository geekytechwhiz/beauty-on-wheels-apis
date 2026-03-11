import { IntegrationMetadata, UserSourceSystem } from '../types/integration.types';

export interface RequestContext {
  correlationId: string;
  tenantId: string;
  serviceToken: string | null;
  source?: string;
  integration?: IntegrationMetadata;
  sourceSystem?: UserSourceSystem;
}