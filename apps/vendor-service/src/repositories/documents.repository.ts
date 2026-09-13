import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { DocumentType } from '../types/api-types';
import { VendorDocumentDdbItem } from '../types/repository.types';
import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

export class DocumentsRepository extends BaseRepository {
  constructor() {
    super();
  }

  public getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async createDocument(item: VendorDocumentDdbItem): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: this.getTableName(),
            Key: {
              PK: VendorKeyBuilder.vendorPk(item.vendorId),
              SK: VendorKeyBuilder.vendorSk(),
            },
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression:
              'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
      ],
    });
  }

  async getDocument(
    vendorId: string,
    documentId: string,
  ): Promise<VendorDocumentDdbItem | null> {
    return this.get<VendorDocumentDdbItem>(this.getTableName(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.documentSk(documentId),
    });
  }

  async listDocuments(vendorId: string): Promise<VendorDocumentDdbItem[]> {
    const queryParams: QueryCommandInput = {
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(vendorId),
        ':skPrefix': VendorKeyBuilder.documentSkPrefix(),
      },
    };

    return this.query<VendorDocumentDdbItem>(queryParams);
  }

  async findByDocumentType(
    vendorId: string,
    documentType: DocumentType,
  ): Promise<VendorDocumentDdbItem | null> {
    const items = await this.listDocuments(vendorId);
    return items.find((item) => item.documentType === documentType) ?? null;
  }

  async updateDocument(item: VendorDocumentDdbItem): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
      ],
    });
  }

  async deleteDocument(vendorId: string, documentId: string): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Delete: {
            TableName: this.getTableName(),
            Key: {
              PK: VendorKeyBuilder.vendorPk(vendorId),
              SK: VendorKeyBuilder.documentSk(documentId),
            },
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
      ],
    });
  }
}

let repository: DocumentsRepository;

export function getDocumentsRepository() {
  if (!repository) {
    repository = new DocumentsRepository();
  }

  return repository;
}
