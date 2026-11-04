import { BaseRepository, ConditionalWriteConflictError } from '@api-hub/utils';

import { env } from '../configs/env.config';
import type { BillingPeriod } from '../domain/offering-lifecycle';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';

export type PlatformPackageStatus = 'draft' | 'published' | 'paused' | 'archived';

export interface PlatformPackageIncludedService {
  name: string;
  serviceKey: string;
  categoryId: string;
  description?: string;
  visitsPerPeriod: number;
  durationMinutes: number;
}

export interface PlatformPackageVehiclePrice {
  vehicleType: string;
  /** Integer minor units (INR paise). */
  price: number;
  durationMinutes: number;
}

export interface PlatformPackageVisitWindow {
  visitWindowId: string;
  label: string;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
}

export interface PlatformPackageRecord {
  PK: string;
  SK: string;
  entityType: 'PlatformPackage';
  packageId: string;
  name: string;
  description?: string;
  categoryId: string;
  billingPeriod: BillingPeriod;
  currency: 'INR';
  displayOrder: number;
  status: PlatformPackageStatus;
  includedServices: PlatformPackageIncludedService[];
  vehiclePricing: PlatformPackageVehiclePrice[];
  visitWindows?: PlatformPackageVisitWindow[];
  version: number;
  publishedVersion?: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PlatformPackageRevision extends Omit<PlatformPackageRecord, 'entityType'> {
  entityType: 'PlatformPackageRevision';
  revisionOf: string;
}

export interface PlatformPackageSalesControl {
  PK: string;
  SK: string;
  entityType: 'PlatformPackageSalesControl';
  packageId: string;
  categoryId: string;
  communityId: string;
  enabled: boolean;
  reason: string;
  fulfilmentVendorIds: string[];
  capacityCommitmentIds: string[];
  effectiveFrom?: string;
  effectiveUntil?: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  GSI3PK?: string;
  GSI3SK?: string;
}

const TABLE = () => env.DYNAMODB_TABLE_NAME;

export class PlatformPackagesRepository extends BaseRepository {
  async getPackage(packageId: string): Promise<PlatformPackageRecord | null> {
    return super.get<PlatformPackageRecord>(TABLE(), { PK: CatalogKeyBuilder.platformPackagePk(packageId), SK: CatalogKeyBuilder.platformPackageSk() });
  }

  async list(params: { categoryId?: string; status?: string; limit?: number; lastEvaluatedKey?: Record<string, unknown> }) {
    const filters: string[] = [];
    const names: Record<string, string> = { '#pk': 'PK', '#sk': 'SK' };
    const values: Record<string, unknown> = { ':pk': CatalogKeyBuilder.platformPackageIndexPk(), ':prefix': 'PACKAGE#' };
    if (params.categoryId) { names['#categoryId'] = 'categoryId'; values[':categoryId'] = params.categoryId; filters.push('#categoryId = :categoryId'); }
    if (params.status) { names['#status'] = 'status'; values[':status'] = params.status; filters.push('#status = :status'); }
    return this.queryPage<PlatformPackageRecord>({
      TableName: TABLE(), KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: names, ExpressionAttributeValues: values,
      ...(filters.length ? { FilterExpression: filters.join(' AND ') } : {}),
      Limit: params.limit, ExclusiveStartKey: params.lastEvaluatedKey as any,
    });
  }

  async getRevision(packageId: string, version: number): Promise<PlatformPackageRevision | null> {
    return super.get<PlatformPackageRevision>(TABLE(), { PK: CatalogKeyBuilder.platformPackagePk(packageId), SK: CatalogKeyBuilder.platformPackageRevisionSk(version) });
  }

  async listRevisions(packageId: string): Promise<PlatformPackageRevision[]> {
    return this.queryAll<PlatformPackageRevision>({ TableName: TABLE(), KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)', ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' }, ExpressionAttributeValues: { ':pk': CatalogKeyBuilder.platformPackagePk(packageId), ':prefix': 'REVISION#' } });
  }

  async create(record: PlatformPackageRecord): Promise<void> {
    await this.transactWrite({ TransactItems: [
      { Put: { TableName: TABLE(), Item: record, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: TABLE(), Item: indexRecord(record) } },
      { Put: { TableName: TABLE(), Item: revisionRecord(record) } },
    ] });
  }

  async save(record: PlatformPackageRecord, expectedVersion: number): Promise<void> {
    await this.transactWrite({ TransactItems: [
      { Put: { TableName: TABLE(), Item: record, ConditionExpression: 'attribute_exists(PK) AND version = :version', ExpressionAttributeValues: { ':version': expectedVersion } } },
      { Put: { TableName: TABLE(), Item: indexRecord(record) } },
      { Put: { TableName: TABLE(), Item: revisionRecord(record), ConditionExpression: 'attribute_not_exists(PK)' } },
    ] });
  }

  async getSalesControl(packageId: string, communityId: string): Promise<PlatformPackageSalesControl | null> {
    return super.get<PlatformPackageSalesControl>(TABLE(), { PK: CatalogKeyBuilder.platformPackagePk(packageId), SK: CatalogKeyBuilder.platformPackageSalesSk(communityId) });
  }

  async listAllIndex(): Promise<PlatformPackageRecord[]> {
    return this.queryAll<PlatformPackageRecord>({
      TableName: TABLE(),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: {
        ':pk': CatalogKeyBuilder.platformPackageIndexPk(),
        ':prefix': 'PACKAGE#',
      },
    });
  }

  async listSalesControls(packageId: string): Promise<PlatformPackageSalesControl[]> {
    return this.queryAll<PlatformPackageSalesControl>({ TableName: TABLE(), KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)', ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' }, ExpressionAttributeValues: { ':pk': CatalogKeyBuilder.platformPackagePk(packageId), ':prefix': CatalogKeyBuilder.platformPackageSalesPrefix() } });
  }

  async listEnabledForCommunity(communityId: string, categoryId?: string): Promise<PlatformPackageSalesControl[]> {
    return this.queryAll<PlatformPackageSalesControl>({
      TableName: TABLE(), IndexName: 'GSI3', KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: { '#pk': 'GSI3PK', '#sk': 'GSI3SK' },
      ExpressionAttributeValues: { ':pk': CatalogKeyBuilder.communityGsi3Pk(communityId), ':prefix': CatalogKeyBuilder.platformPackageCommunityGsi3Prefix(categoryId) },
    });
  }

  async saveSalesControl(record: PlatformPackageSalesControl, expectedVersion?: number): Promise<void> {
    try {
      await this.transactWrite({ TransactItems: [{ Put: { TableName: TABLE(), Item: record, ConditionExpression: expectedVersion === undefined ? 'attribute_not_exists(PK)' : 'version = :version', ...(expectedVersion === undefined ? {} : { ExpressionAttributeValues: { ':version': expectedVersion } }) } }] });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) throw error;
      throw error;
    }
  }
}

function indexRecord(record: PlatformPackageRecord): Record<string, unknown> {
  return { ...record, PK: CatalogKeyBuilder.platformPackageIndexPk(), SK: CatalogKeyBuilder.platformPackageIndexSk(record.packageId), entityType: 'PlatformPackageIndex' };
}
function revisionRecord(record: PlatformPackageRecord): PlatformPackageRevision {
  return { ...record, SK: CatalogKeyBuilder.platformPackageRevisionSk(record.version), entityType: 'PlatformPackageRevision', revisionOf: record.packageId };
}

let repository: PlatformPackagesRepository | undefined;
export function getPlatformPackagesRepository(): PlatformPackagesRepository {
  if (!repository) repository = new PlatformPackagesRepository();
  return repository;
}
