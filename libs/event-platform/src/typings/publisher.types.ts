import { BaseEvent, EventMeta } from "../typings/base-event.types";

import type { Logger } from '@api-hub/logger';
import { PayloadSchemaRegistry } from "./consumer.types";

export type PublishInput<T> = { 
    eventType: string; 
    version?: string; 
    source: string;
   
    payload: T; 
    eventId?: string;
    timestamp?: string;
    idempotencyKey?: string;
   
    correlationId?: string; 
    meta?: Partial<EventMeta>;
  };

   

export type EventPublishAdapter = {
  publish<T = unknown>(event: BaseEvent<T>): Promise<void>;
};

export type VersionCompatibilityStrategy = 'strict' | 'backward' | 'forward';

export type VersionCheckConfig = {
  strategy: VersionCompatibilityStrategy;
  supportedVersion: string;

  deprecatedVersions?: string[];
  onDeprecated?: (version: string) => void;
};

export type EventPublisherDeps = {
  /** Transport adapter (SNS, SQS, Kafka, etc.) */
  adapter: EventPublishAdapter;

  /** Optional schema validation */
  payloadSchemas?: PayloadSchemaRegistry;

  /** Optional version compatibility enforcement */
  versionCheck?: VersionCheckConfig;

  /** Logging */
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;

  /** Default service name */
  serviceName?: string;
};

export type PublishResult =
  | { status: 'success'; eventId: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: unknown };

  export interface IEventPublisher {
    publish<T>(input: PublishInput<T>): Promise<void>;
  }

  export type CreateSnsPublishEventOptions = {
    serviceName: string;
    topicArnEnv: string;
    defaultSource: string;
    region?: string;
  
    payloadSchemas?: PayloadSchemaRegistry;
  
    versionCheck?: VersionCheckConfig;
  
    onBeforeBuild?: (params: {
      eventType: string;
      raw: unknown;
    }) => void;
  };

  export type SchemaResolverInput = {
    eventType: string;
    eventVersion: string;
  };

  export type PublishContext = {
    correlationId: string;
    traceId?: string;
    spanId?: string;
  };

  export type HandleOptions = {
    correlationId?: string;
  };
  
  export type HandleResult =
    | { outcome: 'processed' }
    | { outcome: 'duplicate'; idempotencyKey: string }
    | {
        outcome: 'dead_letter_candidate';
        idempotencyKey: string;
        error: unknown;
      }
    | {
        outcome: 'discarded_non_retryable';
        idempotencyKey: string;
        error: unknown;
      };