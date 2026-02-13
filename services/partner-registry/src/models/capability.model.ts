import type { PartnerCapability, InteropMode } from '@api-hub/partners';

export type { PartnerCapability, InteropMode };

export interface SetCapabilityInput {
  interopMode: InteropMode;
  version?: string;
}
