export interface RequestContext {
    correlationId: string;
    tenantId: string;
    serviceToken: string;
    source?: string;
  }