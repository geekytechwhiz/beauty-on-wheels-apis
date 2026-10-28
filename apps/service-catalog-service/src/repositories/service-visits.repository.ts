import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';
import { ServiceVisitRecord } from '../domain/service-visits';

const ENTITY = 'ServiceVisitConfiguration';

export interface ServiceVisitStore {
  find(vendorId: string, visitId: string): Promise<ServiceVisitRecord | null>;
  list(vendorId: string): Promise<ServiceVisitRecord[]>;
  getByIdempotency(vendorId: string, key: string): Promise<string | null>;
  create(record: ServiceVisitRecord, idempotencyKey: string): Promise<void>;
  replace(record: ServiceVisitRecord, expectedVersion: number): Promise<void>;
}

interface VisitItem extends ServiceVisitRecord {
  PK: string;
  SK: string;
  entityType: typeof ENTITY;
}

export class ServiceVisitsRepository extends BaseRepository implements ServiceVisitStore {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async find(vendorId: string, visitId: string): Promise<ServiceVisitRecord | null> {
    const item = await this.get<VisitItem>(this.getTableName(), {
      PK: CatalogKeyBuilder.vendorPk(vendorId),
      SK: visitSk(visitId),
    });
    return item?.entityType === ENTITY ? strip(item) : null;
  }

  async list(vendorId: string): Promise<ServiceVisitRecord[]> {
    const items = await this.queryAll<VisitItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': CatalogKeyBuilder.vendorPk(vendorId),
        ':prefix': 'SERVICE_VISIT#',
      },
    });
    return items.filter((item) => item.entityType === ENTITY).map(strip);
  }

  async getByIdempotency(vendorId: string, key: string): Promise<string | null> {
    const item = await this.get<{ visitId?: string }>(this.getTableName(), {
      PK: CatalogKeyBuilder.vendorPk(vendorId),
      SK: idempotencySk(key),
    });
    return typeof item?.visitId === 'string' ? item.visitId : null;
  }

  async create(record: ServiceVisitRecord, idempotencyKey: string): Promise<void> {
    const table = this.getTableName();
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: table,
            Item: toItem(record),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: table,
            Item: {
              PK: CatalogKeyBuilder.vendorPk(record.vendorId),
              SK: idempotencySk(idempotencyKey),
              entityType: 'ServiceVisitIdempotency',
              vendorId: record.vendorId,
              visitId: record.visitId,
              createdAt: record.createdAt,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    });
  }

  async replace(record: ServiceVisitRecord, expectedVersion: number): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: toItem(record),
            ConditionExpression: 'version = :expected AND #status <> :archived',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':expected': expectedVersion,
              ':archived': 'archived',
            },
          },
        },
      ],
    });
  }
}

function visitSk(visitId: string): string {
  return `SERVICE_VISIT#${visitId}`;
}

function idempotencySk(key: string): string {
  return `VISIT_IDEMPOTENCY#${key}`;
}

function toItem(record: ServiceVisitRecord): VisitItem {
  return {
    ...record,
    PK: CatalogKeyBuilder.vendorPk(record.vendorId),
    SK: visitSk(record.visitId),
    entityType: ENTITY,
  };
}

function strip(item: VisitItem): ServiceVisitRecord {
  const { PK: _pk, SK: _sk, entityType: _entity, ...record } = item;
  return record;
}

let repository: ServiceVisitsRepository | undefined;

export function getServiceVisitsRepository(): ServiceVisitsRepository {
  if (!repository) {
    repository = new ServiceVisitsRepository();
  }
  return repository;
}
