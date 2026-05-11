export interface DlqMessage {
    originalEvent: unknown;
    error: {
      message: string;
      name?: string;
      stack?: string;
    };
    metadata: {
      eventType?: string;
      eventVersion?: string;
      correlationId?: string;
      retryCount?: number;
      timestamp: string;
    };
  }
  
  export interface DlqStrategy {
    send(message: DlqMessage): Promise<void>;
  }
  
  export type DlqConfig = {
    enabled: boolean;
    strategy?: DlqStrategy;
  
    /** Optional payload enrichment */
    enrich?: (input: {
      event: unknown;
      error: unknown;
      retryCount?: number;
    }) => Partial<DlqMessage>;
  };