import { BaseRepository } from '@api-hub/utils';
import type { ServiceVisitSnapshot } from '@api-hub/event-platform';

import { env } from '../configs/env.config';
import { applyVisitProjection, VisitProjection } from '../domain/visit-projection';

const ENTITY = 'VisitConfig';

interface ProjectionItem extends VisitProjection {
  PK: string;
  SK: string;
  entityType: typeof ENTITY;
}

export class VisitProjectionRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async list(vendorId: string): Promise<VisitProjection[]> {
    const items = await this.queryAll<ProjectionItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `VENDOR#${vendorId}`,
        ':prefix': 'VISIT_CONFIG#',
      },
    });
    return items.filter((item) => item.entityType === ENTITY).map(strip);
  }

  async find(vendorId: string, visitId: string): Promise<VisitProjection | null> {
    const item = await this.get<ProjectionItem>(this.getTableName(), {
      PK: `VENDOR#${vendorId}`,
      SK: `VISIT_CONFIG#${visitId}`,
    });
    return item?.entityType === ENTITY ? strip(item) : null;
  }

  /**
   * Idempotent upsert. A conditional version check ignores a stale or duplicate event.
   * Returns false when the stored version is already newer or equal.
   */
  async apply(snapshot: ServiceVisitSnapshot): Promise<boolean> {
    const current = await this.find(snapshot.vendorId, snapshot.visitId);
    const decision = applyVisitProjection(current, snapshot);
    if (!decision.applied) {
      return false;
    }
    const item: ProjectionItem = {
      ...decision.projection,
      PK: `VENDOR#${snapshot.vendorId}`,
      SK: `VISIT_CONFIG#${snapshot.visitId}`,
      entityType: ENTITY,
    };
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression: 'attribute_not_exists(PK) OR configurationVersion < :version',
            ExpressionAttributeValues: { ':version': snapshot.configurationVersion },
          },
        },
      ],
    });
    return true;
  }
}

function strip(item: ProjectionItem): VisitProjection {
  const { PK: _pk, SK: _sk, entityType: _entity, ...projection } = item;
  return projection;
}

let repository: VisitProjectionRepository | undefined;

export function getVisitProjectionRepository(): VisitProjectionRepository {
  if (!repository) {
    repository = new VisitProjectionRepository();
  }
  return repository;
}
