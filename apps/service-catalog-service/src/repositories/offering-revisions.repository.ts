import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import {
  OfferingRevision,
  OfferingRevisionStore,
} from '../domain/offering-revision';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';

interface OfferingRevisionItem extends OfferingRevision {
  PK: string;
  SK: string;
  entityType: 'OFFERING_REVISION';
  offeringKind: 'SERVICE' | 'PACKAGE';
  updatedAt: string;
}

export class OfferingRevisionsRepository extends BaseRepository implements OfferingRevisionStore {
  constructor(private readonly kind: 'SERVICE' | 'PACKAGE' = 'SERVICE') {
    super();
  }

  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async findRevision(offeringId: string, vendorId: string): Promise<OfferingRevision | null> {
    const item = await this.get<OfferingRevisionItem>(this.getTableName(), {
      PK: CatalogKeyBuilder.offeringRevisionPk(this.kind, offeringId),
      SK: CatalogKeyBuilder.offeringRevisionSk(vendorId),
    });
    if (!item || item.entityType !== 'OFFERING_REVISION') {
      return null;
    }
    return {
      offeringId: item.offeringId,
      vendorId: item.vendorId,
      offeringVersion: item.offeringVersion,
      catalogVersion: item.catalogVersion,
      vendorPricingVersion: item.vendorPricingVersion,
      dependencyVersions: item.dependencyVersions ?? [],
    };
  }

  async putRevision(revision: OfferingRevision, expectedOfferingVersion?: number): Promise<void> {
    const item: OfferingRevisionItem = {
      PK: CatalogKeyBuilder.offeringRevisionPk(this.kind, revision.offeringId),
      SK: CatalogKeyBuilder.offeringRevisionSk(revision.vendorId),
      entityType: 'OFFERING_REVISION',
      offeringKind: this.kind,
      offeringId: revision.offeringId,
      vendorId: revision.vendorId,
      offeringVersion: revision.offeringVersion,
      catalogVersion: revision.catalogVersion,
      vendorPricingVersion: revision.vendorPricingVersion,
      dependencyVersions: revision.dependencyVersions,
      updatedAt: new Date().toISOString(),
    };
    const create = expectedOfferingVersion === undefined;
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression: create
              ? 'attribute_not_exists(PK)'
              : 'offeringVersion = :expectedOfferingVersion',
            ...(create
              ? {}
              : {
                ExpressionAttributeValues: {
                  ':expectedOfferingVersion': expectedOfferingVersion,
                },
              }),
          },
        },
      ],
    });
  }
}

let serviceRevisions: OfferingRevisionsRepository | undefined;
let packageRevisions: OfferingRevisionsRepository | undefined;

export function getOfferingRevisionsRepository(): OfferingRevisionsRepository {
  if (!serviceRevisions) {
    serviceRevisions = new OfferingRevisionsRepository('SERVICE');
  }
  return serviceRevisions;
}

export function getPackageOfferingRevisionsRepository(): OfferingRevisionsRepository {
  if (!packageRevisions) {
    packageRevisions = new OfferingRevisionsRepository('PACKAGE');
  }
  return packageRevisions;
}
