import type {
  RegistryPostMetadataAction,
  RegistryPostMetadataImplementedAction,
} from '../validators/registry-route.validation';

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

/** Parsed `POST /metadata/:entityType?action=publish` input. */
export type RegistryPostMetadataPublishInput = {
  entityType: 'type' | 'value';
  userId?: string;
  body: Record<string, unknown>;
  action: Extract<RegistryPostMetadataAction, 'publish'>;
};

/** Parsed `POST /metadata/:entityType?action=cancel` input. */
export type RegistryPostMetadataCancelInput = {
  entityType: 'type' | 'value';
  userId?: string;
  body: Record<string, unknown>;
  action: Extract<RegistryPostMetadataAction, 'cancel'>;
};