import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '@api-hub/utils';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import type { Partner, PartnerCapability } from '@api-hub/partners';
import type { CreatePartnerInput, UpdatePartnerInput } from '../models/partner.model';
import type { SetCapabilityInput } from '../models/capability.model';
import { PartnerAlreadyExistsError, OrgPartnerLinkExistsError } from '../utils/errors';

const baseLogger = createLogger({ service: 'partner-registry', redactPII: true });
const TABLE_NAME = process.env.INTEGRATION_REGISTRY_TABLE || '';

function pkPartner(partnerId: string): string {
  return `PARTNER#${partnerId}`;
}
function skMeta(): string {
  return 'META';
}
function skCapability(): string {
  return 'CAPABILITY';
}
function pkOrg(orgId: string): string {
  return `ORG#${orgId}`;
}
function skPartner(partnerId: string): string {
  return `PARTNER#${partnerId}`;
}
function pkAudit(): string {
  return 'AUDIT';
}
function skAudit(timestamp: string): string {
  return `AUDIT#${timestamp}`;
}

type PartnerDBItem = Partner & {
  pk: string;
  sk: string;
  lsi2_sk?: string; // status
  lsi3_sk?: string; // interop mode (on capability item)
  lsi1_sk?: string; // relationship type (on org-partner item)
};

function sanitizePartner(item: Record<string, unknown>): Partner {
  const out = { ...item };
  delete out.pk;
  delete out.sk;
  ['lsi1_sk', 'lsi2_sk', 'lsi3_sk', 'lsi4_sk', 'lsi5_sk'].forEach((k) => delete out[k]);
  return out as unknown as Partner;
}

export class PartnerRepository {
  async createPartner(partnerId: string, input: CreatePartnerInput): Promise<Partner> {
    const now = new Date().toISOString();
    const status = input.status ?? 'ACTIVE';
    const item: PartnerDBItem = {
      ...input,
      partnerId,
      name: input.name,
      status,
      endpoints: input.endpoints ?? [],
      createdAt: now,
      updatedAt: now,
      pk: pkPartner(partnerId),
      sk: skMeta(),
      lsi2_sk: status,
    } as PartnerDBItem;
    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item as unknown as Record<string, unknown>,
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        })
      );
      const logger = createChildLogger(baseLogger, { partnerId });
      logger.info({ event: 'partner_created' });
      await this.writeAudit({ event: 'PARTNER_CREATED', partnerId, at: now });
      return sanitizePartner(item as unknown as Record<string, unknown>);
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new PartnerAlreadyExistsError(partnerId);
      }
      baseLogger.error({ event: 'partner_create_error', err: serializeError(err) });
      throw err;
    }
  }

  async getPartner(partnerId: string): Promise<Partner | null> {
    try {
      const result = await ddbDocClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { pk: pkPartner(partnerId), sk: skMeta() },
        })
      );
      if (!result.Item) return null;
      return sanitizePartner(result.Item as Record<string, unknown>);
    } catch (err) {
      baseLogger.error({ event: 'partner_get_error', err: serializeError(err), partnerId });
      throw err;
    }
  }

  async updatePartner(partnerId: string, input: UpdatePartnerInput): Promise<Partner | null> {
    const now = new Date().toISOString();
    const updates: string[] = ['#updatedAt = :updatedAt'];
    const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = { ':updatedAt': now };

    if (input.name !== undefined) {
      updates.push('#name = :name');
      names['#name'] = 'name';
      values[':name'] = input.name;
    }
    if (input.displayName !== undefined) {
      updates.push('#displayName = :displayName');
      names['#displayName'] = 'displayName';
      values[':displayName'] = input.displayName;
    }
    if (input.description !== undefined) {
      updates.push('#description = :description');
      names['#description'] = 'description';
      values[':description'] = input.description;
    }
    if (input.status !== undefined) {
      updates.push('#status = :status', '#lsi2_sk = :lsi2_sk');
      names['#status'] = 'status';
      names['#lsi2_sk'] = 'lsi2_sk';
      values[':status'] = input.status;
      values[':lsi2_sk'] = input.status;
    }
    if (input.endpoints !== undefined) {
      updates.push('#endpoints = :endpoints');
      names['#endpoints'] = 'endpoints';
      values[':endpoints'] = input.endpoints;
    }
    if (updates.length <= 1) return this.getPartner(partnerId);

    try {
      await ddbDocClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: pkPartner(partnerId), sk: skMeta() },
          UpdateExpression: 'SET ' + updates.join(', '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ConditionExpression: 'attribute_exists(pk)',
        })
      );
      await this.writeAudit({ event: 'PARTNER_UPDATED', partnerId, at: now });
      return this.getPartner(partnerId);
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') return null;
      baseLogger.error({ event: 'partner_update_error', err: serializeError(err), partnerId });
      throw err;
    }
  }

  async setCapability(partnerId: string, input: SetCapabilityInput): Promise<PartnerCapability> {
    const now = new Date().toISOString();
    const item = {
      partnerId,
      interopMode: input.interopMode,
      version: input.version,
      updatedAt: now,
      pk: pkPartner(partnerId),
      sk: skCapability(),
      lsi3_sk: input.interopMode,
    };
    await ddbDocClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );
    await this.writeAudit({ event: 'CAPABILITY_SET', partnerId, interopMode: input.interopMode, at: now });
    return { partnerId, interopMode: input.interopMode, version: input.version, updatedAt: now };
  }

  async getCapability(partnerId: string): Promise<PartnerCapability | null> {
    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk: pkPartner(partnerId), sk: skCapability() },
      })
    );
    if (!result.Item) return null;
    const { pk, sk, lsi3_sk, ...rest } = result.Item as Record<string, unknown>;
    return rest as unknown as PartnerCapability;
  }

  async linkOrgPartner(
    organizationId: string,
    partnerId: string,
    relationshipType?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const item = {
      organizationId,
      partnerId,
      linkedAt: now,
      relationshipType: relationshipType ?? 'PARTNER',
      pk: pkOrg(organizationId),
      sk: skPartner(partnerId),
      lsi1_sk: relationshipType ?? 'PARTNER',
    };
    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk) OR attribute_not_exists(sk)',
        })
      );
      await this.writeAudit({
        event: 'ORG_PARTNER_LINKED',
        organizationId,
        partnerId,
        at: now,
      });
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new OrgPartnerLinkExistsError(organizationId, partnerId);
      }
      throw err;
    }
  }

  async listPartnersForOrg(organizationId: string): Promise<{ partnerId: string; organizationId: string; linkedAt: string; relationshipType?: string }[]> {
    const result = await ddbDocClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': pkOrg(organizationId),
          ':sk': 'PARTNER#',
        },
      })
    );
    const items = (result.Items ?? []).map((item) => ({
      partnerId: (item as Record<string, string>).partnerId,
      organizationId: (item as Record<string, string>).organizationId,
      linkedAt: (item as Record<string, string>).linkedAt,
      relationshipType: (item as Record<string, string>).relationshipType,
    }));
    return items;
  }

  async writeAudit(payload: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    const item = {
      ...payload,
      pk: pkAudit(),
      sk: skAudit(now),
      lsi5_sk: now,
    };
    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
        })
      );
    } catch (err) {
      baseLogger.warn({ event: 'audit_write_failed', err: serializeError(err) });
    }
  }
}
