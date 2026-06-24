import type {
  RegistryDeleteMetadataValueAction,
  RegistryGovernedWorkflowAction,
  RegistryPostMetadataAction,
  RegistryPostMetadataImplementedAction,
} from '../validators/registry-route.validation';
import type { Status } from '../models/types';

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

/** Parsed soft-delete request (host validates body via Zod). */
export type RegistryDeleteMetadataValueInput = {
  metadataTypeCode: string;
  valueCode: string;
  userId?: string;
  reason?: string;
  action?: RegistryDeleteMetadataValueAction;
  body?: Record<string, unknown>;
};

/**
 * Parsed `PATCH .../status` input (host validates via Zod).
 * Without `action`, orchestration returns `CHANGE_MANAGEMENT_REQUIRED`.
 */
export type RegistryPatchMetadataStatusInput = {
  entityType: 'type' | 'value';
  userId?: string;
  action?: RegistryGovernedWorkflowAction;
  body: Record<string, unknown>;
  metadataTypeCode?: string;
  valueCode?: string;
  status?: Status;
};