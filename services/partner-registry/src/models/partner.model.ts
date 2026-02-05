import type { Partner, PartnerStatus, PartnerEndpoint } from '@api-hub/partners';

export type { Partner, PartnerStatus, PartnerEndpoint };

export interface CreatePartnerInput {
  name: string;
  displayName?: string;
  description?: string;
  status?: PartnerStatus;
  endpoints?: PartnerEndpoint[];
}

export interface UpdatePartnerInput {
  name?: string;
  displayName?: string;
  description?: string;
  status?: PartnerStatus;
  endpoints?: PartnerEndpoint[];
}
