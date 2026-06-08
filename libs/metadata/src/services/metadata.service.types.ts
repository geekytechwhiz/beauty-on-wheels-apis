import type { RegistryPostMetadataImplementedAction } from '../validators/registry-route.validation';

/** Parsed `POST /metadata/:entityType` input (host validates via Zod). */
export type RegistryPostMetadataInput =
  | {
      entityType: 'type';
      userId?: string;
      body: Record<string, unknown>;
      action: RegistryPostMetadataImplementedAction;
    }
  | {
      entityType: 'value';
      userId?: string;
      body: Record<string, unknown>;
      action: RegistryPostMetadataImplementedAction;
    };