import type { VendorReadinessDetail } from '@api-hub/event-platform';
import { BaseRepository } from '@api-hub/utils';

import { isBankComplete, isBusinessInfoComplete } from '../domain/onboarding';
import { isOnboardingComplete } from '../domain/vendor-self';

import { env } from '../configs/env.config';
import { getCommunitiesRepository, type CommunitiesRepository } from '../repositories/communities.repository';
import type { StaffDdbItem, VendorBankDdbItem, VendorCapabilitiesDdbItem, VendorCommunityDdbItem, VendorDdbItem } from '../types/repository.types';
import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

export interface VendorReadinessSnapshotLoader {
  load(vendorId: string): Promise<VendorReadinessDetail | null>;
}

export class VendorReadinessSnapshotService implements VendorReadinessSnapshotLoader {
  constructor(
    private readonly communities: CommunitiesRepository = getCommunitiesRepository(),
    private readonly consistent: ConsistentVendorReader = new ConsistentVendorReader(),
  ) {}

  async load(vendorId: string): Promise<VendorReadinessDetail | null> {
    const profile = await this.consistent.profile(vendorId);
    if (!profile?.ownerUserId) return null;
    const [memberships, staff, capabilities, bank] = await Promise.all([
      this.consistent.communities(vendorId),
      this.consistent.staff(vendorId),
      this.consistent.capabilities(vendorId),
      this.consistent.bank(vendorId),
    ]);
    const activeCommunities = await this.activeCommunityCount(memberships);
    const activeStaff = staff.filter((member) => member.status === 'ACTIVE');
    return {
      fact: 'vendor',
      approvalStatus: profile.status,
      operationalStatus: profile.operationalStatus,
      onboardingComplete: isOnboardingComplete(profile.onboardingStatus),
      businessProfileComplete: isBusinessInfoComplete(profile),
      ownerUserId: profile.ownerUserId,
      staffUserIds: [...new Set(activeStaff.flatMap((member) => member.userId?.trim() ? [member.userId.trim()] : []))].sort(),
      activeCommunityCount: activeCommunities,
      applicablePricingCount: applicablePricingCount(capabilities),
      teamConfigured: activeStaff.length > 0,
      paymentsConfigured: isBankComplete(bank ?? {}),
    };
  }

  private async activeCommunityCount(memberships: VendorCommunityDdbItem[]): Promise<number> {
    const checks = await Promise.all(memberships.map(async (membership) => {
      const directory = await this.communities.getActiveCommunity(membership.communityId);
      return directory ? 1 : 0;
    }));
    return checks.reduce<number>((sum, value) => sum + value, 0);
  }
}

export function applicablePricingCount(item: VendorCapabilitiesDdbItem | null): number {
  if (!item) return 0;
  if (item.services || item.packages) {
    return (item.services?.filter((entry) => entry.enabled).length ?? 0)
      + (item.packages?.filter((entry) => entry.enabled).length ?? 0);
  }
  return (item.serviceIds?.length ?? 0) + (item.packageIds?.length ?? 0);
}

class ConsistentVendorReader extends BaseRepository {
  private table() {
    return env.DYNAMODB_TABLE_NAME;
  }

  profile(vendorId: string): Promise<VendorDdbItem | null> {
    return this.one<VendorDdbItem>(vendorId, VendorKeyBuilder.vendorSk());
  }

  communities(vendorId: string): Promise<VendorCommunityDdbItem[]> {
    return this.queryAll<VendorCommunityDdbItem>({
      TableName: this.table(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(vendorId),
        ':sk': VendorKeyBuilder.communitySkPrefix(),
      },
      ConsistentRead: true,
    });
  }

  async staff(vendorId: string): Promise<StaffDdbItem[]> {
    const items: StaffDdbItem[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await this.queryPage<StaffDdbItem>({
        TableName: this.table(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': VendorKeyBuilder.vendorPk(vendorId),
          ':sk': VendorKeyBuilder.staffSkPrefix(),
        },
        ExclusiveStartKey: cursor,
        ConsistentRead: true,
      });
      items.push(...page.items);
      cursor = page.lastEvaluatedKey;
    } while (cursor);
    return items;
  }

  capabilities(vendorId: string): Promise<VendorCapabilitiesDdbItem | null> {
    return this.one<VendorCapabilitiesDdbItem>(vendorId, VendorKeyBuilder.capabilitiesSk());
  }

  bank(vendorId: string): Promise<VendorBankDdbItem | null> {
    return this.one<VendorBankDdbItem>(vendorId, VendorKeyBuilder.bankSk());
  }

  private async one<T>(vendorId: string, sk: string): Promise<T | null> {
    const items = await this.queryAll<T>({
      TableName: this.table(),
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(vendorId),
        ':sk': sk,
      },
      ConsistentRead: true,
    });
    return items[0] ?? null;
  }
}
