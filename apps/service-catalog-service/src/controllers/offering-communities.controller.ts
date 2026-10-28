import { LambdaRequest, ValidationError } from '@api-hub/utils';

import { requireVendorId } from '../domain/vendor-scope';
import {
  assertApprovalStatus,
  assertMappingStatus,
  assertMappingVersion,
  getOfferingCommunitiesService,
  OfferingCommunitiesService,
} from '../services/offering-communities.service';
import { approvalActor } from '../utils/helpers/catalog-admin';

export class OfferingCommunitiesController {
  constructor(
    private readonly communities: OfferingCommunitiesService = getOfferingCommunitiesService(),
  ) {}

  async add(request: LambdaRequest) {
    const vendorId = requireVendorId(request.params?.vendorId);
    const offeringId = requireOfferingId(request);
    const service = await this.communities.requireOwnedService(offeringId, vendorId);
    const communityIds = readCommunityIds(request.body);
    return { communities: await this.communities.addCommunities(service, communityIds) };
  }

  async setStatus(request: LambdaRequest) {
    const vendorId = requireVendorId(request.params?.vendorId);
    const offeringId = requireOfferingId(request);
    const communityId = requirePath(request, 'communityId');
    const service = await this.communities.requireOwnedService(offeringId, vendorId);
    const body = asRecord(request.body);
    return this.communities.setStatus(
      service,
      communityId,
      assertMappingStatus(body.status),
      assertMappingVersion(body.version),
    );
  }

  async setApproval(request: LambdaRequest) {
    const offeringId = requireOfferingId(request);
    const communityId = requirePath(request, 'communityId');
    const body = asRecord(request.body);
    return this.communities.setApproval(
      offeringId,
      communityId,
      assertApprovalStatus(body.approvalStatus),
      assertMappingVersion(body.version),
      approvalActor(request),
    );
  }

  async remove(request: LambdaRequest) {
    const vendorId = requireVendorId(request.params?.vendorId);
    const offeringId = requireOfferingId(request);
    const communityId = requirePath(request, 'communityId');
    const service = await this.communities.requireOwnedService(offeringId, vendorId);
    return this.communities.remove(service, communityId);
  }
}

function readCommunityIds(body: unknown): string[] {
  const record = asRecord(body);
  if (!Array.isArray(record.communityIds)) {
    throw new ValidationError('communityIds is required');
  }
  return record.communityIds.filter((value: unknown): value is string => typeof value === 'string');
}

function requireOfferingId(request: LambdaRequest): string {
  const raw = request.params?.offeringId ?? request.params?.serviceId;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ValidationError('offeringId is required');
  }
  return raw.trim();
}

function requirePath(request: LambdaRequest, name: string): string {
  const value = request.params?.[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${name} is required`);
  }
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

let controller: OfferingCommunitiesController | undefined;

export function getOfferingCommunitiesController(): OfferingCommunitiesController {
  if (!controller) {
    controller = new OfferingCommunitiesController();
  }
  return controller;
}
