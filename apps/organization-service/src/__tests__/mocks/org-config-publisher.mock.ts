import { jest } from '@jest/globals';

import type { OrgConfigPublishedPayload } from '../../handlers/events/outbound/org-config-published.event';

type PublishOrgConfigPublishedEvent = (
  payload: OrgConfigPublishedPayload,
  options: { organizationId: string; correlationId: string },
) => Promise<void>;

export const publishOrgConfigPublishedEvent =
  jest.fn<PublishOrgConfigPublishedEvent>().mockResolvedValue(undefined);
