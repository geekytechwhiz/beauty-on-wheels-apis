import { BaseRepository } from '@api-hub/utils';

import { TemplateKeyBuilder } from '../builder/template-key.builder';
import {
  GSI1_ENABLE_SK_PREFIX,
  GSI1_ORG_INDEX,
  GSI3_MASTER_VERSION,
  GSI5_MASTER_STATUS,
  TEMPLATE_META_SK,
} from '../constants/template.constants';
import type { EnablementDdbRecord } from '../models/api/enablement.types';
import { assertTemplateTable } from '../utils/template.utils';

export class EnablementRepository extends BaseRepository {
  async getEnablement(enablementId: string): Promise<EnablementDdbRecord | null> {
    const table = assertTemplateTable();
    return this.get<EnablementDdbRecord>(table, {
      pk: TemplateKeyBuilder.toEnablePk(enablementId),
      sk: TEMPLATE_META_SK,
    });
  }

  async putEnablement(record: EnablementDdbRecord): Promise<void> {
    const table = assertTemplateTable();
    await this.put(table, record, 'attribute_not_exists(pk)');
  }

  async findByOrgAndMasterVersion(
    organizationId: string,
    masterTemplateVersionId: string,
  ): Promise<EnablementDdbRecord | null> {
    const items = await this.queryEnablementsByMasterVersionGsi3(masterTemplateVersionId, 50);
    const prefix = `ORG#${organizationId.trim()}#`;
    return items.find((r) => r.gsi3sk?.startsWith(prefix)) ?? null;
  }

  async findByOrgAndMasterTemplateId(
    organizationId: string,
    masterTemplateId: string,
  ): Promise<EnablementDdbRecord | null> {
    const orgId = organizationId.trim();
    const masterId = masterTemplateId.trim();
    const records = await this.queryEnablementsByOrgGsi1(orgId, 200);
    return (
      records.find((r) => {
        const mid =
          r.meta.masterTemplateId?.trim() ||
          r.meta.masterTemplateVersionId?.replace(/-V\d+$/i, '');
        return mid === masterId;
      }) ?? null
    );
  }

  async queryEnablementsByMasterTemplateGsi5(
    masterTemplateId: string,
    limit: number,
  ): Promise<EnablementDdbRecord[]> {
    const table = assertTemplateTable();
    return this.query<EnablementDdbRecord>({
      TableName: table,
      IndexName: GSI5_MASTER_STATUS,
      KeyConditionExpression: 'gsi5pk = :pk AND begins_with(gsi5sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': TemplateKeyBuilder.buildGsi5EnableMasterPk(masterTemplateId),
        ':prefix': 'ENABLE#ORG#',
      },
      ScanIndexForward: false,
      Limit: limit,
    });
  }

  async queryEnablementsByOrgGsi1(
    organizationId: string,
    limit: number,
  ): Promise<EnablementDdbRecord[]> {
    const table = assertTemplateTable();
    return this.query<EnablementDdbRecord>({
      TableName: table,
      IndexName: GSI1_ORG_INDEX,
      KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': TemplateKeyBuilder.buildGsi1OrgPk(organizationId),
        ':prefix': GSI1_ENABLE_SK_PREFIX,
      },
      ScanIndexForward: false,
      Limit: limit,
    });
  }

  async queryEnablementsByMasterVersionGsi3(
    masterTemplateVersionId: string,
    limit: number,
  ): Promise<EnablementDdbRecord[]> {
    const table = assertTemplateTable();
    return this.query<EnablementDdbRecord>({
      TableName: table,
      IndexName: GSI3_MASTER_VERSION,
      KeyConditionExpression: 'gsi3pk = :pk',
      ExpressionAttributeValues: {
        ':pk': TemplateKeyBuilder.buildGsi3Pk(masterTemplateVersionId),
      },
      ScanIndexForward: false,
      Limit: limit,
    });
  }

  async putEnablementOverwrite(record: EnablementDdbRecord): Promise<void> {
    const table = assertTemplateTable();
    await this.put(table, record);
  }

  async deleteEnablement(enablementId: string): Promise<void> {
    const table = assertTemplateTable();
    await this.delete(table, {
      pk: TemplateKeyBuilder.toEnablePk(enablementId),
      sk: TEMPLATE_META_SK,
    });
  }
}
